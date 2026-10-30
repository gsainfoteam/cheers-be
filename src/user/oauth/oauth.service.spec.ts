import { BadRequestException } from "@nestjs/common";
import { GoogleVerifier } from "./google.verifier";
import { OAuthService } from "./oauth.service";

describe("OAuthService", () => {
  const googleVerifier = { verify: jest.fn() };
  const service = new OAuthService(googleVerifier as unknown as GoogleVerifier);

  beforeEach(() => jest.resetAllMocks());

  it("passes google tokens and the nonce to GoogleVerifier", async () => {
    const profile = { provider: "google", sub: "g-1", email: null };
    googleVerifier.verify.mockResolvedValue(profile);

    await expect(
      service.verify("google", "id-token", "raw-nonce"),
    ).resolves.toBe(profile);
    expect(googleVerifier.verify).toHaveBeenCalledWith("id-token", "raw-nonce");
  });

  it.each(["apple", "naver"] as const)(
    "rejects %s while it is not enabled",
    async (provider) => {
      await expect(service.verify(provider, "token")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(googleVerifier.verify).not.toHaveBeenCalled();
    },
  );
});
