import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AdminAccountRepository } from "@src/database/repository/admin-account.repository";
import { ManagerContext } from "@src/manager/context/manager-context";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";
import { ManagerAuthService } from "@src/manager/manager-auth.service";

const createContext = (request: object) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe("ManagerGuard", () => {
  const authService = { verifyAccessToken: jest.fn() };
  const repository = { findByPk: jest.fn() };
  const guard = new ManagerGuard(
    authService as unknown as ManagerAuthService,
    repository as unknown as AdminAccountRepository,
  );

  beforeEach(() => jest.resetAllMocks());

  it("Bearer 토큰이 없으면 401", async () => {
    await expect(
      guard.canActivate(createContext({ headers: {} })),
    ).rejects.toThrow(new UnauthorizedException("Missing access token"));
  });

  it("계정이 삭제됐으면 401", async () => {
    authService.verifyAccessToken.mockResolvedValue({ sub: "pk" });
    repository.findByPk.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: "Bearer token" } }),
      ),
    ).rejects.toThrow(new UnauthorizedException("Manager not found"));
  });

  it("DB의 현재 role로 request.manager를 담음", async () => {
    authService.verifyAccessToken.mockResolvedValue({ sub: "pk" });
    repository.findByPk.mockResolvedValue({
      pk: "pk",
      email: "a@gm.gist.ac.kr",
      role: "superadmin",
    });
    const request = {
      headers: { authorization: "Bearer token" },
    } as { headers: object; manager?: ManagerContext };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(authService.verifyAccessToken).toHaveBeenCalledWith("token");
    expect(request.manager).toEqual(
      new ManagerContext("pk", "a@gm.gist.ac.kr", "superadmin"),
    );
  });
});

describe("SuperAdminGuard", () => {
  const guard = new SuperAdminGuard();

  it("superadmin은 통과", () => {
    const manager = new ManagerContext("pk", "a@gm.gist.ac.kr", "superadmin");
    expect(guard.canActivate(createContext({ manager }))).toBe(true);
  });

  it("admin은 403", () => {
    const manager = new ManagerContext("pk", "a@gm.gist.ac.kr", "admin");
    expect(() => guard.canActivate(createContext({ manager }))).toThrow(
      ForbiddenException,
    );
  });

  it("ManagerGuard 없이 쓰여도 통과시키지 않음", () => {
    expect(() => guard.canActivate(createContext({}))).toThrow(
      ForbiddenException,
    );
  });
});
