import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { StudentController } from "./student.controller";

const handlers = StudentController.prototype;
const reflector = new Reflector();
const signupStepOf = (handler: object) =>
  reflector.get(SignupStep, handler as () => unknown);

describe("StudentController", () => {
  it("checks the signup step from the DB before the student type", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentController)).toEqual([
      SignupStepGuard,
      UserTypeGuard,
    ]);
    expect(reflector.get(UserTypes, StudentController)).toEqual(["student"]);
  });

  it.each([
    ["sendCode", { step: "verify" }],
    ["verifyCode", { step: "verify" }],
    ["getDepartments", { step: "profile", allowActive: true }],
    ["getInterests", { step: "profile", allowActive: true }],
    ["saveInfo", { step: "profile", allowActive: true }],
  ] as const)("%s runs at signup step %j", (method, options) => {
    expect(signupStepOf(handlers[method])).toEqual(options);
  });
});
