import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { UserContext } from "@src/auth/context/user-context";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { FilePurpose } from "./file.constants";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";

const handlers = FileController.prototype;
const guardsOf = (handler: object) =>
  Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
const userTypesOf = (handler: object) =>
  new Reflector().get(UserTypes, handler as () => unknown);

describe("FileController", () => {
  it("lets pending graduated users request a business card upload URL", () => {
    const handler = handlers.createBusinessCardUploadUrl;

    expect(guardsOf(handler)).toEqual([AnyStatusGuard, UserTypeGuard]);
    expect(userTypesOf(handler)).toEqual(["graduated"]);
  });

  it("lets only active students request a CV · portfolio upload URL", () => {
    const handler = handlers.createAttachmentUploadUrl;

    expect(guardsOf(handler)).toEqual([UserGuard, UserTypeGuard]);
    expect(userTypesOf(handler)).toEqual(["student"]);
  });

  it.each([
    [
      "createBusinessCardUploadUrl",
      FilePurpose.BUSINESS_CARD,
      new UserContext("graduated-pk", "graduated", "pending"),
    ],
    [
      "createAttachmentUploadUrl",
      FilePurpose.ATTACHMENT,
      new UserContext("student-pk", "student", "active"),
    ],
  ] as const)(
    "%s issues the URL for its own purpose",
    async (method, purpose, user) => {
      const createUploadUrl = jest.fn().mockResolvedValue({
        url: "https://signed",
        key: "tmp/k",
        headers: { "Content-Type": "x" },
        expiresIn: 300,
      });
      const controller = new FileController({
        createUploadUrl,
      } as unknown as FileService);

      const response = await controller[method](
        { content_type: "x", size: 1 },
        user,
      );

      expect(createUploadUrl).toHaveBeenCalledWith(
        user.userPk,
        purpose,
        "x",
        1,
      );
      expect(response).toEqual({
        url: "https://signed",
        method: "PUT",
        key: "tmp/k",
        headers: { "Content-Type": "x" },
        expires_in: 300,
      });
    },
  );
});
