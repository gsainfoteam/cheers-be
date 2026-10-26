import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GraduatedInfoRequestDto } from "./graduated-info.dto";

const body = (overrides: Record<string, unknown> = {}) => ({
  nickname: "철수",
  company: "인포테크",
  department: "플랫폼개발팀",
  job: "백엔드 개발자",
  hashtags: ["백엔드"],
  links: ["https://www.linkedin.com/in/chulsoo"],
  contact: {
    email_enabled: true,
    kakao_enabled: true,
    email: "chulsoo@example.com",
    phone: "010-0000-0000",
  },
  ...overrides,
});

const errorsOf = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(GraduatedInfoRequestDto, plain);
  return { dto, errors: await validate(dto) };
};

describe("GraduatedInfoRequestDto", () => {
  it("accepts a valid body and normalizes the phone number", async () => {
    const { dto, errors } = await errorsOf(body());

    expect(errors).toHaveLength(0);
    expect(dto.contact.phone).toBe("01000000000");
  });

  it("accepts a body without optional fields", async () => {
    const { errors } = await errorsOf(
      body({ nickname: undefined, hashtags: undefined, links: undefined }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    ["a hashtag with #", { hashtags: ["#백엔드"] }],
    ["duplicate hashtags", { hashtags: ["백엔드", "백엔드"] }],
    ["more than 10 hashtags", { hashtags: [...Array(11).keys()].map(String) }],
    ["a non-http link", { links: ["ftp://example.com"] }],
    ["a link without protocol", { links: ["www.linkedin.com/in/chulsoo"] }],
    ["more than 5 links", { links: Array(6).fill("https://example.com") }],
    ["a nickname over 32 chars", { nickname: "가".repeat(33) }],
    ["an empty company", { company: "" }],
    [
      "a non-mobile phone number",
      {
        contact: {
          email_enabled: false,
          kakao_enabled: true,
          phone: "0212345678",
        },
      },
    ],
    [
      "an invalid email",
      { contact: { email_enabled: true, kakao_enabled: false, email: "nope" } },
    ],
  ])("rejects %s", async (_, overrides) => {
    const { errors } = await errorsOf(body(overrides));

    expect(errors.length).toBeGreaterThan(0);
  });
});
