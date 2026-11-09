import { BadRequestException } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { Workbook } from "exceljs";
import { extname } from "node:path";
import { TextDecoder } from "node:util";
import {
  normalizeCompanyName,
  toCompanyDisplayName,
} from "@src/company/company.utils";

export const COMPANY_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const COMPANY_IMPORT_MAX_ROWS = 1000;
const MAX_ALIASES = 50;
const VISIBLE_NAME = /^(?=.*[^\p{Z}\p{C}])\P{Cc}*$/su;

export type CompanyImportFile = { originalname: string; buffer: Buffer };
export type ImportName = { name: string; normalizedName: string };
export type ImportRow = {
  row: number;
  name: string;
  names: ImportName[];
  errors: string[];
};

/** 표시는 첫 원문을 유지하고, 대소문자 · 공백만 다른 표기는 한 번만 등록. */
export function toImportRows(cells: unknown[][]): ImportRow[] {
  const [header, ...body] = cells;
  if (
    !header ||
    header.length < 1 ||
    header.length > MAX_ALIASES + 1 ||
    header.some(
      (v, i) =>
        typeof v !== "string" ||
        v
          .replace(/^\uFEFF/, "")
          .trim()
          .toLowerCase() !== (i === 0 ? "company name" : `alias${i}`),
    )
  ) {
    throw new BadRequestException(
      "헤더는 company name, alias1, alias2, … 순서여야 합니다. (별칭 최대 50개)",
    );
  }
  if (body.length > COMPANY_IMPORT_MAX_ROWS) {
    throw new BadRequestException(
      `최대 ${COMPANY_IMPORT_MAX_ROWS}행까지 업로드할 수 있습니다.`,
    );
  }
  const rows: ImportRow[] = [];
  body.forEach((values, index) => {
    if (
      values.every(
        (v) =>
          v === null || v === undefined || (typeof v === "string" && !v.trim()),
      )
    )
      return;
    const errors: string[] = [];
    if (
      values.length > header.length &&
      values
        .slice(header.length)
        .some((v) => v !== null && v !== undefined && v !== "")
    ) {
      errors.push("헤더보다 많은 열이 있습니다.");
    }
    const names = new Map<string, ImportName>();
    values.slice(0, header.length).forEach((value, column) => {
      if (value === null || value === undefined || value === "") return;
      if (typeof value !== "string") {
        errors.push(
          `${column + 1}열: 텍스트만 입력할 수 있습니다. 수식도 허용하지 않습니다.`,
        );
        return;
      }
      const name = toCompanyDisplayName(value);
      if (!name) return;
      const normalizedName = normalizeCompanyName(name);
      if (
        [...name].length > 128 ||
        [...normalizedName].length > 128 ||
        !VISIBLE_NAME.test(name)
      ) {
        errors.push(
          `${column + 1}열: 이름은 제어 문자 없이 128자 이내여야 합니다.`,
        );
        return;
      }
      if (!names.has(normalizedName))
        names.set(normalizedName, { name, normalizedName });
    });
    const name =
      typeof values[0] === "string" ? toCompanyDisplayName(values[0]) : "";
    if (!name) errors.push("회사 대표명이 필요합니다.");
    rows.push({ row: index + 2, name, names: [...names.values()], errors });
  });
  if (!rows.length) throw new BadRequestException("등록할 회사가 없습니다.");
  return rows;
}

export async function parseCompanyImport(
  file: CompanyImportFile | undefined,
): Promise<ImportRow[]> {
  if (!file?.buffer?.length)
    throw new BadRequestException("파일을 선택해 주세요.");
  if (file.buffer.length > COMPANY_IMPORT_MAX_BYTES)
    throw new BadRequestException("파일은 2MB 이하여야 합니다.");
  const extension = extname(file.originalname).toLowerCase();
  let cells: unknown[][];
  try {
    if (extension === ".csv") {
      // 잘못된 UTF-8을 대체 문자로 저장하지 않음. Excel의 CSV UTF-8 저장 형식 지원.
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        file.buffer,
      );
      cells = parse(text, {
        bom: true,
        relax_column_count: true,
        to: COMPANY_IMPORT_MAX_ROWS + 2,
      });
    } else if (extension === ".xlsx") {
      const workbook = new Workbook();
      await workbook.xlsx.load(
        file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
      const sheet = workbook.worksheets[0];
      if (
        !sheet ||
        sheet.rowCount > COMPANY_IMPORT_MAX_ROWS + 1 ||
        sheet.columnCount > MAX_ALIASES + 1
      ) {
        throw new BadRequestException(
          "첫 시트는 헤더 포함 1001행, 51열 이내여야 합니다.",
        );
      }
      cells = [];
      for (let i = 1; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);
        cells.push(
          Array.from(
            { length: Math.max(sheet.getRow(1).cellCount, row.cellCount) },
            (_, col) => row.getCell(col + 1).value,
          ),
        );
      }
    } else {
      throw new BadRequestException(
        ".xlsx 또는 UTF-8 .csv 파일을 업로드해 주세요.",
      );
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      "파일을 읽을 수 없습니다. 손상되지 않은 .xlsx 또는 UTF-8 .csv 파일인지 확인해 주세요.",
    );
  }
  return toImportRows(cells);
}
