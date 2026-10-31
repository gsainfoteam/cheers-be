import { calculateNextStep } from "./signup-step";

const done = {
  hasMissingRequiredConsent: false,
  verified: true,
  hasProfile: true,
};

describe("calculateNextStep", () => {
  it("returns null for active users", () => {
    expect(
      calculateNextStep("active", {
        hasMissingRequiredConsent: true,
        verified: true,
        hasProfile: false,
      }),
    ).toBeNull();
  });

  it("returns verify for active users whose verification was canceled", () => {
    expect(calculateNextStep("active", { ...done, verified: false })).toBe(
      "verify",
    );
  });

  it("returns consent first when a required consent is missing", () => {
    expect(
      calculateNextStep("pending", {
        hasMissingRequiredConsent: true,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("consent");
  });

  it("returns verify after consent", () => {
    expect(
      calculateNextStep("pending", {
        ...done,
        verified: false,
        hasProfile: false,
      }),
    ).toBe("verify");
  });

  it("returns profile after verify", () => {
    expect(calculateNextStep("pending", { ...done, hasProfile: false })).toBe(
      "profile",
    );
  });

  it("returns null when every step is done", () => {
    expect(calculateNextStep("pending", done)).toBeNull();
  });
});
