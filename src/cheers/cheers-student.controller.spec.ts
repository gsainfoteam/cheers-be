import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { CheersStudentController } from "./cheers-student.controller";

const handlers = CheersStudentController.prototype;

describe("CheersStudentController", () => {
  it.each([
    "getGraduatedList",
    "createRequest",
    "getSentList",
    "getSentDetail",
  ] as const)("lets only active students call %s", (name) => {
    const handler = handlers[name];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      UserGuard,
      UserTypeGuard,
    ]);
    expect(new Reflector().get(UserTypes, handler)).toEqual(["student"]);
  });
});
