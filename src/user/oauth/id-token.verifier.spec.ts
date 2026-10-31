import { Logger, UnauthorizedException } from "@nestjs/common";
import { exportJWK, generateKeyPair, JWK, KeyLike, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { IdTokenVerifier } from "./id-token.verifier";

const ISSUER = "https://issuer.example.com";
const AUDIENCE = "client-id";
const NONCE = "raw-nonce";
const KID = "test-key";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// 직접 만든 RSA 키 + 로컬 JWKS 서버. 실제 provider에 접속하지 않음
describe("IdTokenVerifier", () => {
  let server: Server;
  let verifier: IdTokenVerifier;
  let privateKey: KeyLike;
  let otherPrivateKey: KeyLike;

  type TokenOptions = {
    key?: KeyLike;
    kid?: string;
    issuer?: string;
    audience?: string;
    expiresAt?: string;
    subject?: string | null;
    nonceClaim?: string | null;
  };

  const sign = ({
    key = privateKey,
    kid = KID,
    issuer = ISSUER,
    audience = AUDIENCE,
    expiresAt = "1h",
    subject = "google-sub",
    nonceClaim = sha256(NONCE),
  }: TokenOptions = {}) => {
    const jwt = new SignJWT(nonceClaim === null ? {} : { nonce: nonceClaim })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresAt);
    if (subject !== null) jwt.setSubject(subject);
    return jwt.sign(key);
  };

  beforeAll(async () => {
    // 실패 원인을 debug 로그로 남기는데, 테스트 출력에는 필요 없음
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
    const jwk: JWK = {
      ...(await exportJWK(pair.publicKey)),
      kid: KID,
      alg: "RS256",
      use: "sig",
    };

    server = createServer((_, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    verifier = new IdTokenVerifier(
      "TestVerifier",
      `http://127.0.0.1:${port}/certs`,
      [ISSUER, "issuer.example.com"],
      [AUDIENCE, "second-client-id"],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns the payload of a valid token", async () => {
    const payload = await verifier.verify(await sign(), NONCE);

    expect(payload.sub).toBe("google-sub");
    expect(payload.iss).toBe(ISSUER);
  });

  it.each([
    ["the second issuer", { issuer: "issuer.example.com" }],
    ["the second client id", { audience: "second-client-id" }],
  ])("accepts %s", async (_, options) => {
    await expect(verifier.verify(await sign(options), NONCE)).resolves.toEqual(
      expect.objectContaining({ sub: "google-sub" }),
    );
  });

  it.each<[string, () => TokenOptions]>([
    [
      "a signature from another key with the same kid",
      () => ({ key: otherPrivateKey }),
    ],
    ["an unknown kid", () => ({ kid: "unknown-key" })],
    ["a wrong issuer", () => ({ issuer: "https://evil.example.com" })],
    ["a wrong audience", () => ({ audience: "other-client" })],
    ["an expired token", () => ({ expiresAt: "-1m" })],
    ["a token without sub", () => ({ subject: null })],
    ["a token without the nonce claim", () => ({ nonceClaim: null })],
    // 해시하지 않은 원문이 그대로 들어 있어도 통과하면 안 됨
    ["an unhashed nonce claim", () => ({ nonceClaim: NONCE })],
    ["another login's nonce", () => ({ nonceClaim: sha256("other-nonce") })],
  ])("rejects %s", async (_, options) => {
    await expect(verifier.verify(await sign(options()), NONCE)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects when the request has no nonce", async () => {
    await expect(verifier.verify(await sign(), undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token that is not a JWT", async () => {
    await expect(verifier.verify("not-a-jwt", NONCE)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
