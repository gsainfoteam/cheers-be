import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { NicknameCheckQueryDto } from "./nickname-check.dto";

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(NicknameCheckQueryDto, plain);
  return { dto, errors: await validate(dto) };
};

describe("NicknameCheckQueryDto", () => {
  it("accepts a valid nickname and trims it", async () => {
    const { dto, errors } = await check({ nickname: "  철수_1  " });

    expect(errors).toHaveLength(0);
    expect(dto.nickname).toBe("철수_1");
  });

  it.each([undefined, "", "a", "열한글자열한글자열한글", "철 수", "철수!"])(
    "rejects %p",
    async (nickname) => {
      const { errors } = await check({ nickname });

      expect(errors).toHaveLength(1);
    },
  );
});
