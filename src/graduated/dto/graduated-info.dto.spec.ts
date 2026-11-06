import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GraduatedInfoRequestDto } from "./graduated-info.dto";

const body = (overrides: Record<string, unknown> = {}) => ({
  nickname: "철수",
  company_id: 7,
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

  it("accepts a typed company name instead of company_id and trims it", async () => {
    const { dto, errors } = await errorsOf(
      body({ company_id: undefined, company_name: " 마이크로소프트 " }),
    );

    expect(errors).toHaveLength(0);
    expect(dto.company_name).toBe("마이크로소프트");
  });

  it("trims the name and nickname", async () => {
    const { dto, errors } = await errorsOf(
      body({ name: "  김철수 ", nickname: " chul_수1 " }),
    );

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("김철수");
    expect(dto.nickname).toBe("chul_수1");
  });

  it.each([
    ["a hashtag with #", { hashtags: ["#백엔드"] }],
    ["duplicate hashtags", { hashtags: ["백엔드", "백엔드"] }],
    ["more than 5 hashtags", { hashtags: [...Array(6).keys()].map(String) }],
    ["a non-http link", { links: ["ftp://example.com"] }],
    ["a link without protocol", { links: ["www.linkedin.com/in/chulsoo"] }],
    ["more than 5 links", { links: Array(6).fill("https://example.com") }],
    ["a blank name", { name: "   " }],
    ["a blank nickname", { nickname: "   " }],
    ["a 1-char nickname", { nickname: "가" }],
    ["an 11-char nickname", { nickname: "가".repeat(11) }],
    ["a nickname with a space inside", { nickname: "철 수" }],
    ["a nickname with a symbol", { nickname: "철수!" }],
    ["a blank company_name", { company_id: undefined, company_name: "   " }],
    [
      "a company_name over 128 chars",
      { company_id: undefined, company_name: "가".repeat(129) },
    ],
    ["a company_id of 0", { company_id: 0 }],
    ["a company_id out of the integer range", { company_id: 2147483648 }],
    ["a company_id as a string", { company_id: "7" }],
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
