import { maskRecipient } from "./notification.utils";

describe("maskRecipient", () => {
  it("masks a phone number", () => {
    expect(maskRecipient("01012345678")).toBe("010****5678");
  });

  it("masks the local part of an email", () => {
    expect(maskRecipient("gildong@gm.gist.ac.kr")).toBe("gi***@gm.gist.ac.kr");
    expect(maskRecipient("a@b.com")).toBe("a***@b.com");
  });

  it("fully masks a short value", () => {
    expect(maskRecipient("1234")).toBe("****");
  });
});
