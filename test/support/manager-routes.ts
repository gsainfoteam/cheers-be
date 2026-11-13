import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";

export const MANAGER_PREFIX = "/api/manager/v1";

export type RegisteredRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
};

// 앱에 등록된 어드민(/api/manager/v1) 라우트 전체. 컨트롤러 메타데이터에서 읽음
export function listManagerRoutes(app: INestApplication): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  for (const module of app.get(ModulesContainer).values()) {
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
        ] as RegisteredRoute["method"];
        const path = `/${base}/${sub}`.replace(/\/+/g, "/").replace(/\/$/, "");
        if (path.startsWith(MANAGER_PREFIX)) routes.push({ method, path });
      }
    }
  }
  return routes;
}
