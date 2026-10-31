import { BadRequestException } from "@nestjs/common";
import { ParseInterestPkPipe } from "@src/manager/interest/parse-interest-pk.pipe";

describe("ParseInterestPkPipe", () => {
  const pipe = new ParseInterestPkPipe();

  it.each([
    ["1", 1],
    ["2147483647", 2147483647],
  ])("%s는 숫자로 변환", (value, expected) => {
    expect(pipe.transform(value)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "01", "1e3", "2147483648"])(
    "%s는 400",
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
