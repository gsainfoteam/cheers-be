import { toImportRows } from "./company-import.parser";
import { planCompanyImport } from "./company-import.plan";

const input = (rows: string[][]) =>
  toImportRows([["company name", "alias1", "alias2"], ...rows]);
const registered = [
  { normalizedName: "acme", aliasPk: 1, aliasName: "ACME" },
  { normalizedName: "에크미", aliasPk: 1, aliasName: "ACME" },
  { normalizedName: "google", aliasPk: 2, aliasName: "Google" },
];

describe("회사 일괄 등록 계획", () => {
  it("새 회사 · 기존 회사 별칭 추가 · 재업로드를 구분", () => {
    const result = planCompanyImport(
      input([["New", "새회사"], ["ACME", "새별칭"], ["에크미"]]),
      registered,
    );
    expect(result).toMatchObject({
      valid: true,
      created_companies: 1,
      updated_companies: 1,
      added_names: 3,
      skipped_rows: 1,
    });
    expect(result.rows.map((row) => row.action)).toEqual([
      "create",
      "merge",
      "skip",
    ]);
    expect(result.rows[1]).toMatchObject({
      company_id: 1,
      target_name: "ACME",
      added_names: ["새별칭"],
    });
  });

  it("같은 대표명의 반복 행은 한 회사로 묶고 중복 표기는 한 번만 추가", () => {
    const result = planCompanyImport(
      input([["New", "별칭"], [" new ", "별칭", "추가"], ["NEW"]]),
      [],
    );
    expect(result).toMatchObject({
      valid: true,
      created_companies: 1,
      added_names: 3,
      skipped_rows: 1,
    });
    expect(result.rows.map((row) => row.action)).toEqual([
      "create",
      "merge",
      "skip",
    ]);
  });

  it("반복 대표명 중 뒤 행만 기존 회사를 찾아도 모든 행을 같은 회사에 배정", () => {
    const result = planCompanyImport(
      input([
        ["New", "새표기"],
        ["new", "에크미"],
      ]),
      registered,
    );
    expect(result).toMatchObject({
      valid: true,
      created_companies: 0,
      updated_companies: 1,
      added_names: 2,
    });
    expect(result.rows.map((row) => row.company_id)).toEqual([1, 1]);
  });

  it("같은 대표명의 여러 행이 서로 다른 기존 회사를 가리키면 모두 거부", () => {
    const result = planCompanyImport(
      input([
        ["New", "ACME"],
        ["new", "Google"],
      ]),
      registered,
    );
    expect(result.valid).toBe(false);
    expect(result.rows.every((row) => row.action === "error")).toBe(true);
  });

  it("서로 다른 기존 회사를 가리키는 행은 거부", () => {
    const result = planCompanyImport(input([["ACME", "Google"]]), registered);
    expect(result.valid).toBe(false);
    expect(result.rows[0].action).toBe("error");
    expect(result.added_names).toBe(0);
  });

  it("파일 안에서 새 회사끼리 또는 기존 회사와 새 회사가 표기를 공유하면 모두 거부", () => {
    for (const rows of [
      [
        ["New", "공유"],
        ["Other", "공유"],
      ],
      [
        ["ACME", "공유"],
        ["New", "공유"],
      ],
    ]) {
      const result = planCompanyImport(input(rows), registered);
      expect(result.valid).toBe(false);
      expect(result.rows.every((row) => row.action === "error")).toBe(true);
    }
  });

  it("파서 오류를 유지하고 오류 행은 등록 수에 포함하지 않음", () => {
    const result = planCompanyImport(input([["", "별칭"], ["Good"]]), []);
    expect(result).toMatchObject({
      valid: false,
      created_companies: 1,
      added_names: 1,
    });
    expect(result.rows[0].errors).toContain("회사 대표명이 필요합니다.");
  });
});
