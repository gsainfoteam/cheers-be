import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "@src/auth/auth.service";
import { AccessTokenPayload, NextStep } from "@src/auth/auth.types";
import { UserContext } from "@src/auth/context/user-context";
import {
  SignupStep,
  SignupStepOptions,
} from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepService } from "@src/auth/signup-step.service";
import { UserRepository } from "@src/database/repository/user.repository";
import { AnyStatusGuard } from "./any-status.guard";
import { SignupStepGuard } from "./signup-step.guard";
import { UserTypeGuard } from "./user-type.guard";
import { UserGuard } from "./user.guard";

const userPk = "8f1d2c3b-0000-4000-8000-000000000001";
const pending: AccessTokenPayload = {
  sub: userPk,
  type: "student",
  status: "pending",
};
const active: AccessTokenPayload = { ...pending, status: "active" };

const createContext = (
  request: Record<string, unknown>,
  metadata: { step?: SignupStepOptions; types?: string[] } = {},
) => {
  const handler = () => undefined;
  if (metadata.step) SignupStep(metadata.step)(handler);
  if (metadata.types) UserTypes(metadata.types as never)(handler);

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
};

const bearer = (token = "token") => ({
  headers: { authorization: `Bearer ${token}` },
});

describe("auth guards", () => {
  const verifyAccessToken = jest.fn();
  const authService = { verifyAccessToken } as unknown as AuthService;
  const getNextStep = jest.fn<Promise<NextStep>, unknown[]>();
  const signupStepService = { getNextStep } as unknown as SignupStepService;
  const reflector = new Reflector();

  beforeEach(() => jest.clearAllMocks());

  describe("UserGuard", () => {
    const guard = new UserGuard(authService);

    it("passes an active token and sets request.user", async () => {
      verifyAccessToken.mockResolvedValue(active);
      const request = bearer();

      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(verifyAccessToken).toHaveBeenCalledWith("token");
      expect(request).toMatchObject({
        user: new UserContext(userPk, "student", "active"),
      });
    });

    it("rejects a pending token with 403", async () => {
      verifyAccessToken.mockResolvedValue(pending);

      await expect(
        guard.canActivate(createContext(bearer())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(["bearer token", "BEARER token", "Bearer  token", "Bearer token "])(
      "accepts a case-insensitive scheme and extra spaces (%p)",
      async (authorization) => {
        verifyAccessToken.mockResolvedValue(active);

        await expect(
          guard.canActivate(createContext({ headers: { authorization } })),
        ).resolves.toBe(true);
        expect(verifyAccessToken).toHaveBeenCalledWith("token");
      },
    );

    it.each([
      [{ headers: {} }],
      [{ headers: { authorization: "Basic abc" } }],
      [{ headers: { authorization: "Bearer" } }],
      [{ headers: { authorization: "Bearer " } }],
      [{ headers: { authorization: "Bearertoken" } }],
      [{ headers: { authorization: "Bearer a b" } }],
    ])("rejects a missing bearer token with 401 (%o)", async (request) => {
      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it("propagates 401 from token verification", async () => {
      verifyAccessToken.mockRejectedValue(
        new UnauthorizedException("Token expired"),
      );

      await expect(guard.canActivate(createContext(bearer()))).rejects.toThrow(
        "Token expired",
      );
    });
  });

  describe("AnyStatusGuard", () => {
    const guard = new AnyStatusGuard(authService);

    it.each([pending, active])("passes a %o token", async (payload) => {
      verifyAccessToken.mockResolvedValue(payload);

      await expect(guard.canActivate(createContext(bearer()))).resolves.toBe(
        true,
      );
    });
  });

  describe("SignupStepGuard", () => {
    const findByPk = jest.fn();
    const userRepository = { findByPk } as unknown as UserRepository;
    const guard = new SignupStepGuard(
      reflector,
      authService,
      signupStepService,
      userRepository,
    );
    const dbUser = (
      type: "student" | "graduated",
      status: "pending" | "active",
    ) => ({ pk: userPk, type, status, isDeleted: false });

    it("passes a pending user whose next step matches", async () => {
      verifyAccessToken.mockResolvedValue(pending);
      findByPk.mockResolvedValue(dbUser("student", "pending"));
      getNextStep.mockResolvedValue("verify");

      await expect(
        guard.canActivate(
          createContext(bearer(), { step: { step: "verify" } }),
        ),
      ).resolves.toBe(true);
      expect(findByPk).toHaveBeenCalledWith(userPk);
      expect(getNextStep).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: userPk,
          type: "student",
          status: "pending",
        }),
      );
    });

    it("uses the DB type, not the token type, after re-login with another type", async () => {
      // 이전 토큰은 graduated, DB는 student로 다시 시작한 상태
      verifyAccessToken.mockResolvedValue({ ...pending, type: "graduated" });
      findByPk.mockResolvedValue(dbUser("student", "pending"));
      getNextStep.mockResolvedValue("verify");
      const request = bearer();

      await expect(
        guard.canActivate(createContext(request, { step: { step: "verify" } })),
      ).resolves.toBe(true);
      expect(getNextStep).toHaveBeenCalledWith(
        expect.objectContaining({ type: "student" }),
      );
      // 뒤의 UserTypeGuard가 DB 유형으로 판단하도록 request.user도 교체
      expect(request).toMatchObject({
        user: new UserContext(userPk, "student", "pending"),
      });
      expect(() =>
        new UserTypeGuard(reflector).canActivate(
          createContext(request, { types: ["graduated"] }),
        ),
      ).toThrow(ForbiddenException);
    });

    it("rejects a deleted user with 401", async () => {
      verifyAccessToken.mockResolvedValue(pending);
      findByPk.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createContext(bearer(), { step: { step: "consent" } }),
        ),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
        message: "User not found",
      });
      expect(getNextStep).not.toHaveBeenCalled();
    });

    it("passes an allowActive API with a stale pending token after signup completes", async () => {
      verifyAccessToken.mockResolvedValue(pending);
      findByPk.mockResolvedValue(dbUser("student", "active"));

      await expect(
        guard.canActivate(
          createContext(bearer(), {
            step: { step: "profile", allowActive: true },
          }),
        ),
      ).resolves.toBe(true);
      expect(getNextStep).not.toHaveBeenCalled();
    });

    it("rejects a pending user on another step with 403", async () => {
      verifyAccessToken.mockResolvedValue(pending);
      findByPk.mockResolvedValue(dbUser("student", "pending"));
      getNextStep.mockResolvedValue("consent");

      await expect(
        guard.canActivate(
          createContext(bearer(), { step: { step: "verify" } }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects an active user unless allowActive is set", async () => {
      verifyAccessToken.mockResolvedValue(active);
      findByPk.mockResolvedValue(dbUser("student", "active"));

      await expect(
        guard.canActivate(
          createContext(bearer(), { step: { step: "verify" } }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        guard.canActivate(
          createContext(bearer(), {
            step: { step: "profile", allowActive: true },
          }),
        ),
      ).resolves.toBe(true);
      expect(getNextStep).not.toHaveBeenCalled();
    });

    it("fails closed without @SignupStep", async () => {
      await expect(guard.canActivate(createContext(bearer()))).rejects.toThrow(
        "SignupStepGuard requires @SignupStep()",
      );
    });
  });

  describe("UserTypeGuard", () => {
    const guard = new UserTypeGuard(reflector);
    const withUser = (type: "student" | "graduated") => ({
      user: new UserContext(userPk, type, "active"),
    });

    it("passes an allowed type", () => {
      expect(
        guard.canActivate(
          createContext(withUser("student"), { types: ["student"] }),
        ),
      ).toBe(true);
    });

    it("rejects another type with 403", () => {
      expect(() =>
        guard.canActivate(
          createContext(withUser("graduated"), { types: ["student"] }),
        ),
      ).toThrow(ForbiddenException);
    });

    it("fails closed without an authentication guard before it", () => {
      expect(() =>
        guard.canActivate(createContext({}, { types: ["student"] })),
      ).toThrow("UserTypeGuard must be used after an authentication guard");
    });
  });
});
