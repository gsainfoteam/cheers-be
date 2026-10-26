// Nest 앱 밖에서 class-transformer 데코레이터를 쓰므로 직접 불러옴
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SaveStudentInfoRequestDto } from "./save-student-info.dto";

const body = (overrides: Record<string, unknown> = {}) => ({
  department_id: 1,
  interests: ["반도체"],
  contact: {
    email_enabled: false,
    kakao_enabled: true,
    phone: "010-1234-5678",
  },
  ...overrides,
});

const validateBody = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(SaveStudentInfoRequestDto, plain);
  return { dto, errors: await validate(dto) };
};

describe("SaveStudentInfoRequestDto", () => {
  it("strips hyphens and spaces from the phone number", async () => {
    const { dto, errors } = await validateBody(body());

    expect(errors).toEqual([]);
    expect(dto.contact.phone).toBe("01012345678");
  });

  it("trims interest and activity entries", async () => {
    const { dto, errors } = await validateBody(
      body({ interests: [" 반도체 "], activities: [" 학부 연구생"] }),
    );

    expect(errors).toEqual([]);
    expect(dto.interests).toEqual(["반도체"]);
    expect(dto.activities).toEqual(["학부 연구생"]);
  });

  it.each([
    [
      "a non-mobile phone",
      {
        contact: {
          email_enabled: false,
          kakao_enabled: true,
          phone: "021234567",
        },
      },
    ],
    ["empty interests", { interests: [] }],
    ["duplicate interests", { interests: ["반도체", "반도체"] }],
    ["a blank interest", { interests: ["반도체", "   "] }],
    ["duplicate activities", { activities: ["동아리", " 동아리 "] }],
    [
      "a file attachment (CRB-38)",
      { attachments: [{ kind: "cv", source: "file", url: "https://a.com" }] },
    ],
    [
      "a non-http link",
      { attachments: [{ kind: "cv", source: "link", url: "ftp://a.com" }] },
    ],
    ["a string department id", { department_id: "1" }],
  ])("rejects %s", async (_, overrides) => {
    const { errors } = await validateBody(body(overrides));

    expect(errors).not.toEqual([]);
  });
});
