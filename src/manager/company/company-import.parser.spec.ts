import { BadRequestException } from "@nestjs/common";
import { Workbook } from "exceljs";
import {
  COMPANY_IMPORT_MAX_BYTES,
  parseCompanyImport,
  toImportRows,
} from "./company-import.parser";

const csv = (text: string) => ({
  originalname: "companies.csv",
  buffer: Buffer.from(text),
});

describe("회사 일괄 등록 파서", () => {
  it("BOM · 따옴표 · 한글을 읽고 정규화한 중복 표기는 첫 원문만 유지", async () => {
    const rows = await parseCompanyImport(
      csv('\uFEFFcompany name,alias1,alias2\r\n"Acme, Inc",에크미,에크미\r\n'),
    );
    expect(rows[0]).toMatchObject({
      row: 2,
      name: "Acme, Inc",
      errors: [],
      names: [
        { name: "Acme, Inc", normalizedName: "acme, inc" },
        { name: "에크미", normalizedName: "에크미" },
      ],
    });
    expect(
      toImportRows([
        ["company name", "alias1"],
        [" ACME ", "acme"],
      ])[0].names,
    ).toHaveLength(1);
  });

  it("xlsx 첫 시트를 읽고 숫자 · 수식은 행 오류로 표시", async () => {
    const book = new Workbook();
    book.addWorksheet("회사").addRows([
      ["company name", "alias1"],
      ["회사", 123],
      ["다른회사", { formula: "1+1", result: 2 }],
    ]);
    const rows = await parseCompanyImport({
      originalname: "companies.xlsx",
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.errors.length === 1)).toBe(true);
  });

  it.each([
    "name,alias1\n회사,별칭",
    "company name,alias2\n회사,별칭",
    "company name\n",
    "company name\n\n",
  ])("잘못된 헤더나 빈 파일 거부: %s", async (text) => {
    await expect(parseCompanyImport(csv(text))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("없는 파일 · 지원하지 않는 확장자 · 손상 파일 · 잘못된 UTF-8 · 2MB 초과 거부", async () => {
    for (const file of [
      undefined,
      { originalname: "a.txt", buffer: Buffer.from("text") },
      { originalname: "a.xlsx", buffer: Buffer.from("broken") },
      { originalname: "a.csv", buffer: Buffer.from([0xff]) },
      {
        originalname: "a.csv",
        buffer: Buffer.alloc(COMPANY_IMPORT_MAX_BYTES + 1),
      },
    ]) {
      await expect(parseCompanyImport(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it("1000행 · 별칭 50개까지 허용하고 초과하면 거부", async () => {
    const header = [
      "company name",
      ...Array.from({ length: 50 }, (_, i) => `alias${i + 1}`),
    ];
    expect(
      toImportRows([
        header,
        ...Array.from({ length: 1000 }, (_, i) => [`회사${i}`]),
      ]),
    ).toHaveLength(1000);
    expect(() => toImportRows([[...header, "alias51"], ["회사"]])).toThrow(
      BadRequestException,
    );
    await expect(
      parseCompanyImport(csv("company name\n" + "회사\n".repeat(1001))),
    ).rejects.toThrow(BadRequestException);
  });

  it("빈 행은 건너뛰고 대표명 누락 · 길이 · 제어 문자 · 초과 열을 행 오류로 표시", () => {
    const rows = toImportRows([
      ["company name", "alias1"],
      [],
      ["", "별칭"],
      ["x".repeat(129)],
      ["회\u0000사"],
      ["회사", "별칭", "초과"],
    ]);
    expect(rows.map((row) => row.row)).toEqual([3, 4, 5, 6]);
    expect(rows.every((row) => row.errors.length > 0)).toBe(true);
  });
});
