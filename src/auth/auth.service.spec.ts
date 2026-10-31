import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, generateKeyPairSync } from "node:crypto";
import { JwtKeyService } from "@src/auth/jwt-key.service";
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
    findByOpaqueHash: jest.fn(),
    deleteByOpaqueHashAndUserPk: jest.fn(),
    deleteByUserPk: jest.fn(),
  };
  const userRepository = {
    findByPk: jest.fn(),
    updateLastActiveAt: jest.fn(),
  };

  const createService = (
    env: Record<string, string | undefined>,
    jwtKeyService = { privateKey, publicKey } as unknown as JwtKeyService,
  ) =>
    new AuthService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      jwtService,
      jwtKeyService,
      refreshTokenRepository as unknown as RefreshTokenRepository,
      userRepository as unknown as UserRepository,
    );

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService({});
  });

  it("does not issue tokens when keys are not loaded", async () => {
    const notLoaded = {
      get privateKey(): string {
        throw new Error("JWT signing key is not loaded yet.");
      },
    } as unknown as JwtKeyService;

    await expect(
      createService({}, notLoaded).issueTokens(pendingStudent, tx),
    ).rejects.toThrow("JWT signing key is not loaded yet.");
  });

  it.each(["30", "30 minutes", "1w", "abc", ""])(
    "throws on startup when ACCESS_TOKEN_EXPIRES_IN is %p",
    (value) => {
      expect(() => createService({ ACCESS_TOKEN_EXPIRES_IN: value })).toThrow(
        "ACCESS_TOKEN_EXPIRES_IN must look like 30m, 1h",
      );
    },
  );

  it.each(["30d", "abc", "0", "-1", "1.5", ""])(
    "throws on startup when REFRESH_TOKEN_EXPIRE_DAYS is %p",
    (value) => {
      expect(() => createService({ REFRESH_TOKEN_EXPIRE_DAYS: value })).toThrow(
        "REFRESH_TOKEN_EXPIRE_DAYS must be a positive integer",
      );
    },
  );

  it("uses the configured expiry values", async () => {
    const configured = createService({
      ACCESS_TOKEN_EXPIRES_IN: "15m",
      REFRESH_TOKEN_EXPIRE_DAYS: "7",
    });

    const { accessToken } = await configured.issueTokens(pendingStudent, tx);

    const { iat, exp } = jwtService.decode(accessToken);
    expect(exp - iat).toBe(15 * 60);
    const [row] = refreshTokenRepository.insert.mock.calls[0];
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
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
      const { accessToken, refreshToken } = await service.issueTokens(
        pendingStudent,
        tx,
      );

      const [row, usedTx] = refreshTokenRepository.insert.mock.calls[0];
      expect(usedTx).toBe(tx);
      expect(row.opaqueHash).toBe(sha256(refreshToken));
      expect(row.opaqueHash).not.toBe(refreshToken);
      expect(row.userPk).toBe(pendingStudent.pk);
      const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeCloseTo(180, 1);
      // access token 기본 수명 1시간
      const { iat, exp } = jwtService.decode(accessToken);
      expect(exp - iat).toBe(60 * 60);
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

    it("issues only an access token built from the current DB status", async () => {
      refreshTokenRepository.findByOpaqueHash.mockResolvedValue(stored(60_000));
      userRepository.findByPk.mockResolvedValue({
        ...pendingStudent,
        status: "active",
      });

      const tokens = await service.refresh("old-token");

      expect(refreshTokenRepository.findByOpaqueHash).toHaveBeenCalledWith(
        sha256("old-token"),
      );
      expect(tokens).toEqual({ accessToken: expect.any(String) });
      await expect(
        service.verifyAccessToken(tokens.accessToken),
      ).resolves.toMatchObject({ status: "active" });
      expect(userRepository.updateLastActiveAt).toHaveBeenCalledWith(
        pendingStudent.pk,
      );
    });

    it("keeps the refresh token as it is", async () => {
      refreshTokenRepository.findByOpaqueHash.mockResolvedValue(stored(60_000));
      userRepository.findByPk.mockResolvedValue(pendingStudent);

      await service.refresh("old-token");

      expect(refreshTokenRepository.insert).not.toHaveBeenCalled();
      expect(
        refreshTokenRepository.deleteByOpaqueHashAndUserPk,
      ).not.toHaveBeenCalled();
      expect(refreshTokenRepository.deleteByUserPk).not.toHaveBeenCalled();
    });

    it("rejects an unknown token", async () => {
      refreshTokenRepository.findByOpaqueHash.mockResolvedValue(null);

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("Invalid refresh token"),
      );
    });

    it("rejects an expired token", async () => {
      refreshTokenRepository.findByOpaqueHash.mockResolvedValue(stored(-1_000));

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("Refresh token expired"),
      );
    });

    it("rejects when the user is deleted", async () => {
      refreshTokenRepository.findByOpaqueHash.mockResolvedValue(stored(60_000));
      userRepository.findByPk.mockResolvedValue(null);

      await expect(service.refresh("old-token")).rejects.toThrow(
        new UnauthorizedException("User not found"),
      );
    });
  });

  it("logout deletes the hashed token of the user without a transaction", async () => {
    await service.logout("old-token", pendingStudent.pk);

    expect(
      refreshTokenRepository.deleteByOpaqueHashAndUserPk,
    ).toHaveBeenCalledWith(sha256("old-token"), pendingStudent.pk);
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
