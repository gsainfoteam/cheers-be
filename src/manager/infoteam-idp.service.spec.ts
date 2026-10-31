import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InfoteamIdpService } from "@src/manager/infoteam-idp.service";

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const IDP_ENV = {
  IDP_URL: "https://idp.test/",
  IDP_CLIENT_ID: "client-id",
  IDP_CLIENT_SECRET: "client-secret",
};

const jsonResponse = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

describe("InfoteamIdpService", () => {
  let fetchSpy: jest.SpyInstance;
  let service: InfoteamIdpService;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch");
    service = new InfoteamIdpService(config(IDP_ENV));
  });
  afterEach(() => fetchSpy.mockRestore());

  describe("constructor", () => {
    it("production에서 값이 비면 서버가 뜨지 않음", () => {
      expect(
        () =>
          new InfoteamIdpService(
            config({
              ...IDP_ENV,
              NODE_ENV: "production",
              IDP_CLIENT_SECRET: "",
            }),
          ),
      ).toThrow("required in production");
    });

    it("로컬에서는 뜨고 로그인할 때 실패함", async () => {
      const local = new InfoteamIdpService(config({}));
      await expect(local.getEmail("token")).rejects.toThrow("not configured");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("exchangeAuthorizationCode", () => {
    it("code를 client secret과 함께 보내고 access token을 돌려줌", async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { access_token: "idp-at" }));

      await expect(
        service.exchangeAuthorizationCode("code", "https://a/cb", "verifier"),
      ).resolves.toBe("idp-at");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://idp.test/oauth/token");
      expect(JSON.parse(init.body)).toEqual({
        grant_type: "authorization_code",
        client_id: "client-id",
        client_secret: "client-secret",
        code: "code",
        redirect_uri: "https://a/cb",
        code_verifier: "verifier",
      });
    });

    it("IdP가 4xx면 401", async () => {
      fetchSpy.mockResolvedValue(jsonResponse(400));
      await expect(
        service.exchangeAuthorizationCode("code", "uri", "verifier"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ["5xx", () => Promise.resolve(jsonResponse(503))],
      ["access_token 없음", () => Promise.resolve(jsonResponse(200))],
      ["네트워크 오류", () => Promise.reject(new TypeError("fetch failed"))],
    ])("%s면 401이 아닌 오류 (500으로 응답)", async (_, respond) => {
      fetchSpy.mockImplementation(respond);
      const error = await service
        .exchangeAuthorizationCode("code", "uri", "verifier")
        .catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("getEmail", () => {
    it("IdP access token으로 이메일을 읽음", async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, { email: "a@gm.gist.ac.kr" }),
      );

      await expect(service.getEmail("idp-at")).resolves.toBe("a@gm.gist.ac.kr");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://idp.test/oauth/userinfo");
      expect(init.headers).toEqual({ Authorization: "Bearer idp-at" });
    });

    it("email이 없으면 null", async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { sub: "x" }));
      await expect(service.getEmail("idp-at")).resolves.toBeNull();
    });

    it("IdP가 401이면 401", async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401));
      await expect(service.getEmail("idp-at")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("그 외 오류는 401이 아닌 오류 (500으로 응답)", async () => {
      fetchSpy.mockResolvedValue(jsonResponse(500));
      const error = await service.getEmail("idp-at").catch((e) => e);
      expect(error).not.toBeInstanceOf(UnauthorizedException);
    });
  });
});
