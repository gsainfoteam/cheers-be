import { GUARDS_METADATA, HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { CheersGraduatedController } from "./cheers-graduated.controller";

const handlers = CheersGraduatedController.prototype;

describe("CheersGraduatedController", () => {
  it.each([
    "getReceivedList",
    "getReceivedDetail",
    "accept",
    "shareContact",
  ] as const)("lets only active graduates call %s", (name) => {
    const handler = handlers[name];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      UserGuard,
      UserTypeGuard,
    ]);
    expect(new Reflector().get(UserTypes, handler)).toEqual(["graduated"]);
  });

  it.each(["accept", "shareContact"] as const)(
    "answers %s with 200 because it is idempotent",
    (name) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlers[name])).toBe(200);
    },
  );
});
