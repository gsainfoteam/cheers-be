import { calculateNextStep } from "./signup-step";

const done = {
  hasMissingRequiredConsent: false,
  verified: true,
  hasProfile: true,
};

describe("calculateNextStep", () => {
  it("returns null for active users", () => {
    expect(
      calculateNextStep("active", "student", {
        hasMissingRequiredConsent: true,
        verified: true,
        hasProfile: false,
      }),
    ).toBeNull();
  });

  it("returns null for active graduated users without verification", () => {
    expect(
      calculateNextStep("active", "graduated", { ...done, verified: false }),
    ).toBeNull();
  });

  it("returns consent first when a required consent is missing", () => {
    expect(
      calculateNextStep("pending", "student", {
        hasMissingRequiredConsent: true,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("consent");
  });

  it("returns verify after consent for students", () => {
    expect(
      calculateNextStep("pending", "student", {
        ...done,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("verify");
  });

  it("returns profile after verify for students", () => {
    expect(
      calculateNextStep("pending", "student", { ...done, hasProfile: false }),
    ).toBe("profile");
  });

  it("skips verify for graduated users", () => {
    expect(
      calculateNextStep("pending", "graduated", {
        ...done,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("profile");
  });

  it("returns consent first for graduated users", () => {
    expect(
      calculateNextStep("pending", "graduated", {
        hasMissingRequiredConsent: true,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("consent");
  });

  it("returns null when every step is done", () => {
    expect(calculateNextStep("pending", "student", done)).toBeNull();
    expect(
      calculateNextStep("pending", "graduated", { ...done, verified: false }),
    ).toBeNull();
  });
});
