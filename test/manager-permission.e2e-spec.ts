import { randomUUID } from "node:crypto";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { createE2eApp, E2eContext } from "./support/app";
import { bearer, http, loginManager, signupStudent } from "./support/flows";

const PREFIX = "/api/manager/v1";

type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  // SuperAdminGuard가 걸려 있으면 true (일반 admin은 403)
  superOnly: boolean;
};

const route = (
  method: Route["method"],
  path: string,
  superOnly = false,
): Route => ({ method, path: `${PREFIX}${path}`, superOnly });

// 어드민 API 전체. 라우트를 추가하면 여기에도 넣어야 아래의 "빠진 라우트" 검사를 통과함
const ROUTES: Route[] = [
  route("GET", "/auth/me"),

  route("GET", "/admin-account"),
  route("POST", "/admin-account", true),
  route("PATCH", "/admin-account/:pk", true),
  route("DELETE", "/admin-account/:pk", true),

  route("GET", "/interest"),
  route("POST", "/interest"),
  route("PUT", "/interest/order"),
  route("PATCH", "/interest/:pk"),
  route("DELETE", "/interest/:pk"),

  route("GET", "/school"),
  route("GET", "/school/:schoolPk/department"),
  route("POST", "/school/:schoolPk/department"),
  route("PATCH", "/school/:schoolPk/department/:departmentPk"),
  route("PUT", "/school/:schoolPk/email-domain", true),

  route("GET", "/business-card"),
  route("GET", "/business-card/:graduatedPk"),
  route("POST", "/business-card/:graduatedPk/cancel-verification", true),

  route("GET", "/consent"),
  route("POST", "/consent", true),
  route("GET", "/consent/:type/:version/status"),

  route("GET", "/coffee-chat/request"),
  route("GET", "/coffee-chat/request/:pk"),
  route("GET", "/coffee-chat/notification-log"),

  route("GET", "/company"),
  route("GET", "/company/search"),
  route("POST", "/company"),
  route("POST", "/company/logo/upload-url"),
  route("PATCH", "/company/:pk"),
  route("DELETE", "/company/:pk"),
  route("POST", "/company/:pk/name"),
  route("DELETE", "/company/:pk/name/:namePk"),
  route("POST", "/company/:pk/merge"),
  route("PUT", "/company/:pk/logo"),
];

// 표에서 뺀 라우트와 이유
const EXCLUDED: { method: Route["method"]; path: string }[] = [
  // 토큰 없이 부르는 로그인 (manager-auth.e2e-spec.ts)
  { method: "POST", path: `${PREFIX}/auth/login` },
  // DEV_USER_DELETE_ENABLED가 꺼진 기본값에서는 권한과 상관없이 404 (dev-user-delete.e2e-spec.ts)
  { method: "GET", path: `${PREFIX}/dev/user` },
  { method: "DELETE", path: `${PREFIX}/dev/user/:userPk` },
];

// 없는 대상을 가리키는 값. 가드를 통과해도 400 · 404로 끝나 데이터가 바뀌지 않음
const PARAMS: Record<string, string> = {
  pk: "999",
  schoolPk: "999",
  departmentPk: "999",
  namePk: "999",
  type: "e2e_none",
  version: "e2e-none",
};
const UUID_PARAMS: Record<string, string[]> = {
  pk: ["/admin-account/", "/coffee-chat/request/"],
};

const fill = (path: string) =>
  path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
    if (name === "graduatedPk") return randomUUID();
    if (UUID_PARAMS[name]?.some((segment) => path.includes(segment))) {
      return randomUUID();
    }
    const value = PARAMS[name];
    if (!value) throw new Error(`No sample value for :${name} in ${path}`);
    return value;
  });

const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe("어드민 API 권한", () => {
  let ctx: E2eContext;
  let adminAuth: string;
  let superAuth: string;
  let userAuth: string;

  const call = (r: Route, auth?: string) => {
    const req = http(ctx)[
      r.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"
    ](fill(r.path));
    return (auth ? req.set("Authorization", auth) : req).send({});
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
    await ctx.reset();
    adminAuth = await loginManager(ctx, "admin@gm.gist.ac.kr", "admin");
    superAuth = await loginManager(ctx, "super@gm.gist.ac.kr", "superadmin");
    userAuth = bearer(await signupStudent(ctx));
  });
  afterAll(async () => {
    await ctx.reset();
    await ctx.close();
  });

  it("앱에 등록된 어드민 라우트가 표(ROUTES · EXCLUDED)와 정확히 같음", () => {
    const registered: string[] = [];
    for (const module of ctx.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new () => object) | null;
        if (!controller) continue;
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        const proto = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (name === "constructor" || typeof handler !== "function") continue;
          const sub = Reflect.getMetadata(PATH_METADATA, handler) as
            | string
            | undefined;
          if (sub === undefined) continue;
          const method = RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
          ] as Route["method"];
          const path = `/${base}/${sub}`
            .replace(/\/+/g, "/")
            .replace(/\/$/, "");
          if (path.startsWith(PREFIX)) registered.push(key({ method, path }));
        }
      }
    }

    expect(registered.sort()).toEqual([...ROUTES, ...EXCLUDED].map(key).sort());
  });

  it.each(ROUTES.map((r) => [key(r), r] as const))(
    "%s: 토큰 없음 · 사용자 토큰은 401",
    async (_, r) => {
      await call(r).expect(401);
      await call(r, userAuth).expect(401);
    },
  );

  it.each(ROUTES.map((r) => [key(r), r] as const))(
    "%s: admin · superadmin 권한",
    async (_, r) => {
      const asAdmin = await call(r, adminAuth);
      if (r.superOnly) {
        expect(asAdmin.status).toBe(403);
      } else {
        expect([401, 403]).not.toContain(asAdmin.status);
      }
      const asSuper = await call(r, superAuth);
      expect([401, 403]).not.toContain(asSuper.status);
    },
  );
});
