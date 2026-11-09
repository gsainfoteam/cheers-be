export class CompanyImportRowDto {
  /** 파일의 행 번호 (헤더는 1행) */
  row: number;
  name: string;
  names: string[];
  company_id: number | null;
  /** 기존 회사에 합칠 때 유지되는 대표명 */
  target_name: string | null;
  action: "create" | "merge" | "skip" | "error";
  added_names: string[];
  errors: string[];
}

export class CompanyImportResultDto {
  valid: boolean;
  created_companies: number;
  updated_companies: number;
  added_names: number;
  skipped_rows: number;
  rows: CompanyImportRowDto[];
}
