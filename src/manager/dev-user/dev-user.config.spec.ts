import { ExecutionContext, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DevUserDeleteEnabledGuard } from "./dev-user-delete-enabled.guard";
import { isDevUserDeleteEnabled } from "./dev-user.config";

const createConfig = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const contextOf = (method: string, originalUrl: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ method, originalUrl }) }),
  }) as unknown as ExecutionContext;

describe("isDevUserDeleteEnabled", () => {
  it.each(["true", " true "])("is on for %p", (value) => {
    expect(
      isDevUserDeleteEnabled(createConfig({ DEV_USER_DELETE_ENABLED: value })),
    ).toBe(true);
  });

  it.each([undefined, "", "   ", "false", " false "])(
    "is off for %p",
    (value) => {
      expect(
        isDevUserDeleteEnabled(
          createConfig({ DEV_USER_DELETE_ENABLED: value }),
        ),
      ).toBe(false);
    },
  );

  it.each(["1", "0", "yes", "TRUE", "ture"])("throws on %s", (value) => {
    expect(() =>
      isDevUserDeleteEnabled(createConfig({ DEV_USER_DELETE_ENABLED: value })),
    ).toThrow(`DEV_USER_DELETE_ENABLED must be true or false (got "${value}")`);
  });
});

describe("DevUserDeleteEnabledGuard", () => {
  it("꺼져 있으면 없는 경로와 같은 404", () => {
    const guard = new DevUserDeleteEnabledGuard(createConfig({}));

    expect(() =>
      guard.canActivate(contextOf("DELETE", "/api/manager/v1/dev/user/x")),
    ).toThrow(
      new NotFoundException("Cannot DELETE /api/manager/v1/dev/user/x"),
    );
  });

  it("켜져 있으면 통과", () => {
    const guard = new DevUserDeleteEnabledGuard(
      createConfig({ DEV_USER_DELETE_ENABLED: "true" }),
    );

    expect(
      guard.canActivate(contextOf("GET", "/api/manager/v1/dev/user")),
    ).toBe(true);
  });

  it("값이 잘못되면 생성할 때 실패 (서버가 뜨지 않음)", () => {
    expect(
      () =>
        new DevUserDeleteEnabledGuard(
          createConfig({ DEV_USER_DELETE_ENABLED: "yes" }),
        ),
    ).toThrow("DEV_USER_DELETE_ENABLED must be true or false");
  });
});
