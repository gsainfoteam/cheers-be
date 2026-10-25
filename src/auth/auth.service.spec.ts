import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, generateKeyPairSync } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { TxType } from "@src/global/types/tx.types";
import { AuthService } from "./auth.service";
import { TokenSubject } from "./auth.types";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const unauthorized = (message: string) => ({
  constructor: UnauthorizedException,
  message,
});

const pendingStudent: TokenSubject = {
  pk: "8f1d2c3b-0000-4000-8000-000000000001",
  type: "student",
  status: "pending",
};

describe("AuthService", () => {
  const tx = {} as TxType;
  const jwtService = new JwtService();
  const refreshTokenRepository = {
    insert: jest.fn(),
    deleteByOpaqueHash: jest.fn(),
    deleteByOpaqueHashAndUserPk: jest.fn(),
    deleteByUserPk: jest.fn(),
  };
  const userRepository = {
    findByPk: jest.fn(),
    updateLastActiveAt: jest.fn(),
  };
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };

  const createService = (env: Record<string, string | undefined>) =>
    new AuthService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      jwtService,
      dbService as unknown as DatabaseService,
      refreshTokenRepository as unknown as RefreshTokenRepository,
      userRepository as unknown as UserRepository,
    );

  const keys = {
    // env에는 \n 이스케이프로 들어오는 경우를 확인
    JWT_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
    JWT_PUBLIC_KEY: publicKey,
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService(keys);
  });

  it("throws on startup when keys are not set", () => {
    expect(() => createService({})).toThrow(
      "JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required.",
    );
  });

  describe("issueTokens", () => {
    it("signs an RS256 access token with sub, type and status", async () => {
      const { accessToken } = await service.issueTokens(pendingStudent, tx);

      const payload = await service.verifyAccessToken(accessToken);
      expect(payload).toMatchObject({
        sub: pendingStudent.pk,
        type: "student",
        status: "pending",
        iss: "Cheers",
      });
      expect(
        jwtService.decode(accessToken, { complete: true }).header.alg,
      ).toBe("RS256");
    });

    it("stores only the hash of the refresh token and updates last_active_at", async () => {
      const { refreshToken } = await service.issueTokens(pendingStudent, tx);

      const [row, usedTx] = refreshTokenRepository.insert.mock.calls[0];
      expect(usedTx).toBe(tx);
      expect(row.opaqueHash).toBe(sha256(refreshToken));
      expect(row.opaqueHash).not.toBe(refreshToken);
      expect(row.userPk).toBe(pendingStudent.pk);
      const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeCloseTo(30, 1);
      expect(userRepository.updateLastActiveAt).toHaveBeenCalledWith(
        pendingStudent.pk,
        tx,
      );
    });

    it("issues a different refresh token every time", async () => {
      const first = await service.issueTokens(pendingStudent, tx);
      const second = await service.issueTokens(pendingStudent, tx);

      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  describe("refresh", () => {
    const stored = (expiresInMs: number) => ({
      opaqueHash: sha256("old-token"),
      userPk: pendingStudent.pk,
      expiresAt: new Date(Date.now() + expiresInMs),
      createdAt: new Date(),
    });

    it("rotates the token and rebuilds claims from the current DB status", async () => {
      refreshTokenRepository.deleteByOpaqueHash.mockResolvedValue(
        stored(60_000),
      );
      userRepository.findByPk.mockResolvedValue({
        ...pendingStudent,
        status: "active",
      });

      const tokens = await service.refresh("old-token");

      expect(refreshTokenRepository.deleteByOpaqueHash).toHaveBeenCalledWith(
        sha256("old-token"),
        tx,
      );
      expect(refreshTokenRepository.insert).toHaveBeenCalledTimes(1);
      expect(tokens.refreshToken).not.toBe("old-token");
      await expect(
        service.verifyAccessToken(tokens.accessToken),
      ).resolves.toMatchObject({ status: "active" });
    });

    it("rejects an unknown or already used token", async () => {
      refreshTokenRepository.deleteByOpaqueHash.mockResolvedValue(null);

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("Invalid refresh token"),
      );
      expect(refreshTokenRepository.insert).not.toHaveBeenCalled();
    });

    it("rejects an expired token", async () => {
      refreshTokenRepository.deleteByOpaqueHash.mockResolvedValue(
        stored(-1_000),
      );

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("Refresh token expired"),
      );
    });

    it("rejects when the user is deleted", async () => {
      refreshTokenRepository.deleteByOpaqueHash.mockResolvedValue(
        stored(60_000),
      );
      userRepository.findByPk.mockResolvedValue(null);

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("User not found"),
      );
    });
  });

  it("logout deletes the hashed token of the user", async () => {
    await service.logout("old-token", pendingStudent.pk);

    expect(
      refreshTokenRepository.deleteByOpaqueHashAndUserPk,
    ).toHaveBeenCalledWith(sha256("old-token"), pendingStudent.pk, tx);
  });

  it("revokeAllTokens deletes every token of the user", async () => {
    await service.revokeAllTokens(pendingStudent.pk, tx);

    expect(refreshTokenRepository.deleteByUserPk).toHaveBeenCalledWith(
      pendingStudent.pk,
      tx,
    );
  });

  describe("verifyAccessToken", () => {
    it("rejects an expired token", async () => {
      const token = await jwtService.signAsync(
        { sub: pendingStudent.pk, type: "student", status: "pending" },
        {
          algorithm: "RS256",
          privateKey,
          issuer: "Cheers",
          expiresIn: -10,
        },
      );

      await expect(service.verifyAccessToken(token)).rejects.toMatchObject(
        unauthorized("Token expired"),
      );
    });

    it("rejects a token signed with another key", async () => {
      const other = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const token = await jwtService.signAsync(
        { sub: pendingStudent.pk },
        { algorithm: "RS256", privateKey: other.privateKey, issuer: "Cheers" },
      );

      await expect(service.verifyAccessToken(token)).rejects.toMatchObject(
        unauthorized("Invalid token"),
      );
    });

    it("rejects a malformed token", async () => {
      await expect(
        service.verifyAccessToken("not-a-jwt"),
      ).rejects.toMatchObject(unauthorized("Invalid token"));
    });
  });
});
