import { ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { generateKeyPairSync } from "node:crypto";
import { JwtKeyService } from "@src/auth/jwt-key.service";
import { AdminAccountRepository } from "@src/database/repository/admin-account.repository";
import { InfoteamIdpService } from "@src/manager/infoteam-idp.service";
import { ManagerAuthService } from "@src/manager/manager-auth.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("ManagerAuthService", () => {
  const jwtService = new JwtService({});
  const idp = {
    exchangeAuthorizationCode: jest.fn(),
    getEmail: jest.fn(),
  };
  const repository = { findByEmail: jest.fn() };
  const service = new ManagerAuthService(
    jwtService,
    { privateKey, publicKey } as unknown as JwtKeyService,
    idp as unknown as InfoteamIdpService,
    repository as unknown as AdminAccountRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    idp.exchangeAuthorizationCode.mockResolvedValue("idp-at");
  });

  describe("login", () => {
    it("IdP 이메일을 정규화해 찾고, pk만 담은 1일짜리 토큰을 발급", async () => {
      idp.getEmail.mockResolvedValue(" Admin@GM.gist.ac.kr ");
      repository.findByEmail.mockResolvedValue({ pk: "admin-pk" });

      const token = await service.login("code", "uri", "verifier");

      expect(idp.exchangeAuthorizationCode).toHaveBeenCalledWith(
        "code",
        "uri",
        "verifier",
      );
      expect(repository.findByEmail).toHaveBeenCalledWith(
        "admin@gm.gist.ac.kr",
      );
      const decoded = jwtService.decode(token);
      expect(decoded).toEqual({
        sub: "admin-pk",
        iss: "Cheers-Manager",
        iat: expect.any(Number),
        exp: expect.any(Number),
      });
      expect(decoded.exp - decoded.iat).toBe(24 * 60 * 60);
    });

    it("허용 목록에 없으면 403", async () => {
      idp.getEmail.mockResolvedValue("other@gm.gist.ac.kr");
      repository.findByEmail.mockResolvedValue(null);

      await expect(service.login("code", "uri", "verifier")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("IdP가 이메일을 주지 않으면 조회 없이 403", async () => {
      idp.getEmail.mockResolvedValue(null);

      await expect(service.login("code", "uri", "verifier")).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.findByEmail).not.toHaveBeenCalled();
    });
  });

  describe("verifyAccessToken", () => {
    const sign = (issuer: string, expiresIn: "1h" | "-1s" = "1h") =>
      jwtService.sign(
        { sub: "admin-pk" },
        { algorithm: "RS256", privateKey, issuer, expiresIn },
      );

    it("매니저 토큰은 통과", async () => {
      await expect(
        service.verifyAccessToken(sign("Cheers-Manager")),
      ).resolves.toMatchObject({ sub: "admin-pk" });
    });

    it("사용자 토큰(issuer Cheers)은 같은 키로 서명돼도 거부", async () => {
      await expect(service.verifyAccessToken(sign("Cheers"))).rejects.toThrow(
        "Invalid token",
      );
    });

    it("만료된 토큰은 Token expired", async () => {
      await expect(
        service.verifyAccessToken(sign("Cheers-Manager", "-1s")),
      ).rejects.toThrow("Token expired");
    });
  });
});
