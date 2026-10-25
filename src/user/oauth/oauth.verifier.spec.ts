import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtVerify } from "jose";
import { AppleVerifier } from "./apple.verifier";
import { GoogleVerifier } from "./google.verifier";
import { NaverVerifier } from "./naver.verifier";

// 실제 provider는 호출하지 않음: JWKS 다운로드와 서명 검증(jose), Naver 프로필 API(fetch)를 mock
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => "jwks"),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jwtVerify as jest.Mock;

const config = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe("GoogleVerifier", () => {
  beforeEach(() => mockedJwtVerify.mockReset());

  it("requires GOOGLE_CLIENT_ID", () => {
    expect(() => new GoogleVerifier(config({}))).toThrow(
      "GOOGLE_CLIENT_ID is required.",
    );
  });

  it("verifies iss / aud against every configured client ID", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: "g-1", email: "a@gmail.com", name: "홍길동" },
    });
    const verifier = new GoogleVerifier(
      config({ GOOGLE_CLIENT_ID: "web-id, app-id" }),
    );

    await expect(verifier.verify("id-token")).resolves.toEqual({
      provider: "google",
      sub: "g-1",
      email: "a@gmail.com",
      name: "홍길동",
    });
    expect(mockedJwtVerify).toHaveBeenCalledWith("id-token", "jwks", {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: ["web-id", "app-id"],
    });
  });

  it("returns 401 when jose rejects the token (signature, aud, iss, exp)", async () => {
    mockedJwtVerify.mockRejectedValue(
      new Error('unexpected "aud" claim value'),
    );
    const verifier = new GoogleVerifier(config({ GOOGLE_CLIENT_ID: "web-id" }));

    await expect(verifier.verify("bad")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("returns 401 when sub is missing", async () => {
    mockedJwtVerify.mockResolvedValue({ payload: {} });
    const verifier = new GoogleVerifier(config({ GOOGLE_CLIENT_ID: "web-id" }));

    await expect(verifier.verify("no-sub")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe("AppleVerifier", () => {
  beforeEach(() => mockedJwtVerify.mockReset());

  it("requires APPLE_CLIENT_ID", () => {
    expect(() => new AppleVerifier(config({}))).toThrow(
      "APPLE_CLIENT_ID is required.",
    );
  });

  it("uses Apple issuer and never returns a name", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: "a-1", email: "x@privaterelay.appleid.com", name: "x" },
    });
    const verifier = new AppleVerifier(
      config({ APPLE_CLIENT_ID: "kr.gistory.cheers" }),
    );

    await expect(verifier.verify("id-token")).resolves.toEqual({
      provider: "apple",
      sub: "a-1",
      email: "x@privaterelay.appleid.com",
      name: null,
    });
    expect(mockedJwtVerify).toHaveBeenCalledWith("id-token", "jwks", {
      issuer: ["https://appleid.apple.com"],
      audience: ["kr.gistory.cheers"],
    });
  });
});

describe("NaverVerifier", () => {
  const verifier = new NaverVerifier();
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  beforeEach(() => fetchMock.mockReset());

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });

  it("maps the profile API response", async () => {
    respond(200, {
      resultcode: "00",
      message: "success",
      response: { id: "n-1", email: "c@naver.com", name: "김철수" },
    });

    await expect(verifier.verify("access-token")).resolves.toEqual({
      provider: "naver",
      sub: "n-1",
      email: "c@naver.com",
      name: "김철수",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openapi.naver.com/v1/nid/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("returns 401 when Naver rejects the token", async () => {
    respond(401, { resultcode: "024", message: "Authentication failed" });

    await expect(verifier.verify("expired")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("returns 401 when resultcode is not 00", async () => {
    respond(200, { resultcode: "028", message: "no token" });

    await expect(verifier.verify("x")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("returns 401 when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));

    await expect(verifier.verify("x")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
