import { ValidationPipe } from "@nestjs/common";
import {
  CreateDepartmentRequestDto,
  ReplaceEmailDomainsRequestDto,
  UpdateDepartmentRequestDto,
} from "@src/manager/department/dto/school-department.dto";
import { ParsePkPipe } from "@src/manager/department/parse-pk.pipe";

const INVALID = "Bad Request Exception";
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: "body", metatype });

describe("ReplaceEmailDomainsRequestDto", () => {
  const validate = (email_domains: unknown) =>
    body(ReplaceEmailDomainsRequestDto, { email_domains });

  it("trims and lowercases domains", async () => {
    await expect(validate([" GM.Gist.ac.kr ", "a-b.co.kr"])).resolves.toEqual({
      email_domains: ["gm.gist.ac.kr", "a-b.co.kr"],
    });
  });

  it.each([
    ["빈 목록", []],
    ["배열이 아님", "gm.gist.ac.kr"],
    ["문자열이 아닌 항목", [1]],
    ["소문자로 맞추면 중복", ["a.ac.kr", "A.ac.kr"]],
    ["21개", Array.from({ length: 21 }, (_, i) => `d${i}.ac.kr`)],
    ["129자", [`${"a.".repeat(62)}aaaa.kr`]],
    ["점 없음", ["localhost"]],
    ["@ 포함", ["user@gist.ac.kr"]],
    ["@로 시작", ["@gist.ac.kr"]],
    ["와일드카드", ["*.gist.ac.kr"]],
    ["밑줄", ["a_b.ac.kr"]],
    ["퍼센트", ["a%.ac.kr"]],
    ["포트", ["gist.ac.kr:443"]],
    ["경로", ["gist.ac.kr/a"]],
    ["끝에 점", ["gist.ac.kr."]],
    ["연속 점", ["gist..ac.kr"]],
    ["하이픈으로 시작", ["-a.ac.kr"]],
    ["숫자 TLD", ["1.2.3.4"]],
    ["한글", ["지스트.kr"]],
    ["빈 문자열", [""]],
  ])("rejects %s", async (_, value) => {
    await expect(validate(value)).rejects.toThrow(INVALID);
  });
});

describe("department name", () => {
  it("trims the name", async () => {
    await expect(
      body(CreateDepartmentRequestDto, { name: "  AI학과 " }),
    ).resolves.toEqual({ name: "AI학과" });
  });

  it.each([[""], ["   "], ["가".repeat(65)], [1], [null]])(
    "rejects %j",
    async (name) => {
      await expect(body(CreateDepartmentRequestDto, { name })).rejects.toThrow(
        INVALID,
      );
      await expect(body(UpdateDepartmentRequestDto, { name })).rejects.toThrow(
        INVALID,
      );
    },
  );

  it("accepts a partial update but no null or non-boolean is_active", async () => {
    await expect(
      body(UpdateDepartmentRequestDto, { is_active: false }),
    ).resolves.toEqual({ is_active: false });
    await expect(
      body(UpdateDepartmentRequestDto, { is_active: null }),
    ).rejects.toThrow(INVALID);
    await expect(
      body(UpdateDepartmentRequestDto, { is_active: "false" }),
    ).rejects.toThrow(INVALID);
  });
});

describe("ParsePkPipe", () => {
  const parse = new ParsePkPipe();

  it("accepts positive int4 values", () => {
    expect(parse.transform("1")).toBe(1);
    expect(parse.transform("2147483647")).toBe(2147483647);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "2147483648", "99999999999999"])(
    "rejects %j",
    (value) => {
      expect(() => parse.transform(value)).toThrow("Invalid pk");
    },
  );
});
