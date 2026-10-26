// Nest 앱 밖에서 class-transformer 데코레이터를 쓰므로 직접 불러옴
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SendCodeRequestDto } from "./send-code.dto";

const validateEmail = async (email: string) => {
  const dto = plainToInstance(SendCodeRequestDto, { email });
  return { dto, errors: await validate(dto) };
};

describe("SendCodeRequestDto", () => {
  it("trims and lowercases the email", async () => {
    const { dto, errors } = await validateEmail(" GilDong@GM.gist.ac.kr ");

    expect(errors).toEqual([]);
    expect(dto.email).toBe("gildong@gm.gist.ac.kr");
  });

  it("rejects a plus address", async () => {
    const { errors } = await validateEmail("gildong+1@gm.gist.ac.kr");

    expect(errors).not.toEqual([]);
  });
});
