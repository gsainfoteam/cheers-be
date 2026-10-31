import { maskPersonalInfo, maskRecipient } from "./notification.utils";

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

describe("maskPersonalInfo", () => {
  it.each([
    ["the recipient", "fail 01012345678", "01012345678", "fail 010****5678"],
    [
      "a hyphenated phone number",
      "bad 010-1234-5678",
      "01012345678",
      "bad 010****5678",
    ],
    [
      "a phone number with a country code",
      "bad +82 10 1234 5678",
      "x",
      "bad 821****5678",
    ],
    [
      "an email in another case",
      "550 <GilDong@Example.com> rejected",
      "gildong@example.com",
      "550 <Gi***@Example.com> rejected",
    ],
    [
      "emails other than the recipient",
      "cc other.user@example.com, a@b.co",
      "gildong@example.com",
      "cc ot***@example.com, a***@b.co",
    ],
    ["an email with $", "to a$&b@x.com", "a$&b@x.com", "to a$***@x.com"],
  ])("masks %s", (_, text, recipient, expected) => {
    expect(maskPersonalInfo(text, recipient)).toBe(expected);
  });

  it("keeps text without personal info", () => {
    expect(maskPersonalInfo("-99 token expired", "01012345678")).toBe(
      "-99 token expired",
    );
    expect(maskPersonalInfo("500 1234567890123456", "01012345678")).toBe(
      "500 1234567890123456",
    );
    expect(maskPersonalInfo("connect timeout", "")).toBe("connect timeout");
  });

  it("does not change already masked values", () => {
    expect(
      maskPersonalInfo("gi***@example.com 010****5678", "01012345678"),
    ).toBe("gi***@example.com 010****5678");
  });
});
