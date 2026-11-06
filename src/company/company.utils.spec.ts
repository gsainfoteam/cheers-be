import { escapeLike, normalizeCompanyName } from "./company.utils";

describe("normalizeCompanyName", () => {
  it.each([
    ["Microsoft", "microsoft"],
    ["  MICROSOFT  ", "microsoft"],
    ["Microsoft   Korea", "microsoft korea"],
    ["마이크로소프트", "마이크로소프트"],
    // 자모가 분리된(NFD) 한글도 같은 키
    ["마이크로소프트".normalize("NFD"), "마이크로소프트"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});
