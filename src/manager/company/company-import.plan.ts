import { normalizeCompanyName } from "@src/company/company.utils";
import type { ImportRow } from "./company-import.parser";
import { CompanyImportResultDto } from "./dto/company-import.dto";

export type RegisteredImportName = {
  normalizedName: string;
  aliasPk: number;
  aliasName: string;
};

/** DB 상태와 파일 전체를 함께 검증. 다른 회사 사이의 충돌은 자동 병합하지 않음. */
export function planCompanyImport(
  input: ImportRow[],
  registered: RegisteredImportName[],
): CompanyImportResultDto {
  const byName = new Map(registered.map((n) => [n.normalizedName, n]));
  // 같은 대표명의 반복 행은 함께 판단. 뒤 행의 기존 표기로 회사를 찾은 경우도 앞 행에 반영.
  const ownersByCompany = new Map<string, Map<number, string>>();
  for (const row of input) {
    const key = normalizeCompanyName(row.name);
    const owners = ownersByCompany.get(key) ?? new Map<number, string>();
    for (const name of row.names) {
      const existing = byName.get(name.normalizedName);
      if (existing) owners.set(existing.aliasPk, existing.aliasName);
    }
    ownersByCompany.set(key, owners);
  }
  const keys: string[] = [];
  const rows = input.map((row) => {
    const owners = ownersByCompany.get(normalizeCompanyName(row.name))!;
    const [owner] = owners;
    const errors = [...row.errors];
    if (owners.size > 1)
      errors.push(
        `여러 기존 회사의 표기와 충돌합니다: ${[...owners.values()].join(", ")}`,
      );
    keys.push(
      owner ? `id:${owner[0]}` : `new:${normalizeCompanyName(row.name)}`,
    );
    return {
      row: row.row,
      name: row.name,
      names: row.names.map((n) => n.name),
      company_id: owner?.[0] ?? null,
      target_name: owner?.[1] ?? null,
      action: "skip" as "create" | "merge" | "skip" | "error",
      added_names: [] as string[],
      errors,
    };
  });
  // 같은 파일 안에서도 한 표기가 서로 다른 새 회사에 배정되면 양쪽 행에 표시.
  const occurrences = new Map<string, number[]>();
  input.forEach((row, i) =>
    row.names.forEach((n) => {
      const indices = occurrences.get(n.normalizedName) ?? [];
      indices.push(i);
      occurrences.set(n.normalizedName, indices);
    }),
  );
  for (const [name, indices] of occurrences) {
    if (new Set(indices.map((i) => keys[i])).size > 1) {
      for (const i of indices)
        rows[i].errors.push(
          `파일 내 다른 회사와 표기가 겹칩니다: ${name} (${indices.map((j) => rows[j].row).join(", ")}행)`,
        );
    }
  }
  const seen = new Set(byName.keys());
  const created = new Set<string>();
  const updated = new Set<number>();
  rows.forEach((row, i) => {
    if (row.errors.length) {
      row.action = "error";
      return;
    }
    for (const name of input[i].names) {
      if (!seen.has(name.normalizedName)) {
        seen.add(name.normalizedName);
        row.added_names.push(name.name);
      }
    }
    if (row.company_id === null && !created.has(keys[i])) {
      created.add(keys[i]);
      row.action = "create";
    } else if (row.added_names.length) {
      row.action = "merge";
      if (row.company_id !== null) updated.add(row.company_id);
    }
  });
  return {
    valid: rows.every((row) => !row.errors.length),
    created_companies: created.size,
    updated_companies: updated.size,
    added_names: rows.reduce((count, row) => count + row.added_names.length, 0),
    skipped_rows: rows.filter((row) => row.action === "skip").length,
    rows,
  };
}
