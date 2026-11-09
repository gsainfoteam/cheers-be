import { useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { errorMessage } from "../lib/format";

type ImportResult = {
  valid: boolean;
  created_companies: number;
  updated_companies: number;
  added_names: number;
  skipped_rows: number;
  rows: {
    row: number;
    name: string;
    names: string[];
    company_id: number | null;
    target_name: string | null;
    action: "create" | "merge" | "skip" | "error";
    added_names: string[];
    errors: string[];
  }[];
};

const ACTION_LABELS = {
  create: "신규",
  merge: "병합",
  skip: "건너뜀",
  error: "오류",
};
const IMPORT_PATH = "/api/manager/v1/company/import";

function downloadSample() {
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFFcompany name,alias1,alias2\r\nMicrosoft,마이크로소프트,MS\r\n"],
      {
        type: "text/csv;charset=utf-8",
      },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "company-import-sample.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function CompanyImportPanel({
  onImported,
}: {
  onImported: () => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [previewedFile, setPreviewedFile] = useState<File | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const upload = async (commit: boolean) => {
    if (!file || inFlight.current) return;
    if (commit) {
      if (!result?.valid || previewedFile !== file) return;
      if (
        !window.confirm(
          `"${file.name}"의 회사를 일괄 등록할까요? 기존 회사에 표기가 추가될 수 있습니다.`,
        )
      )
        return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    setPreviewedFile(null);
    setCommitted(false);
    try {
      const body = new FormData();
      body.append("file", file);
      const next = await api.upload<ImportResult>(
        commit ? IMPORT_PATH : `${IMPORT_PATH}/preview`,
        body,
      );
      setResult(next);
      setCommitted(commit);
      if (!commit && next.valid) setPreviewedFile(file);
      if (commit) {
        try {
          await onImported();
        } catch (err) {
          setError(
            `등록은 완료했지만 회사 목록을 새로 불러오지 못했습니다. ${errorMessage(err, "새로고침해 주세요.")}`,
          );
        }
      }
    } catch (err) {
      setError(
        errorMessage(
          err,
          commit
            ? "회사를 일괄 등록하지 못했습니다."
            : "미리보기를 불러오지 못했습니다.",
        ),
      );
      if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { preview?: ImportResult } | null;
        if (body?.preview) setResult(body.preview);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      className="card company-import"
      aria-labelledby="company-import-title"
      aria-busy={busy}
    >
      <h3 id="company-import-title">회사 일괄 등록</h3>
      <p className="placeholder" id="company-import-help">
        .xlsx 또는 UTF-8 .csv · 최대 2MB / 1000행 / 별칭 50개. 첫 행은 company
        name, alias1, alias2, ... 형식으로 입력해 주세요. Excel은 첫 시트만
        읽습니다.
      </p>
      <div className="row-form">
        <input
          type="file"
          accept=".xlsx,.csv"
          aria-label="회사 일괄 등록 파일"
          aria-describedby="company-import-help"
          disabled={busy}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            setFile(next);
            setResult(null);
            setPreviewedFile(null);
            setCommitted(false);
            setError(
              next && next.size > 2 * 1024 * 1024
                ? "파일은 2MB 이하여야 합니다."
                : null,
            );
          }}
        />
        <button
          className="button secondary small"
          disabled={busy || !file || file.size > 2 * 1024 * 1024}
          onClick={() => void upload(false)}
        >
          미리보기
        </button>
        <button
          className="button small"
          disabled={
            busy || !result?.valid || previewedFile !== file || committed
          }
          onClick={() => void upload(true)}
        >
          등록
        </button>
        <button className="button secondary small" onClick={downloadSample}>
          샘플 CSV 다운로드
        </button>
      </div>
      {busy && <p role="status">처리 중...</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status">
            {committed ? "등록 완료" : "미리보기"}: 신규 회사{" "}
            {result.created_companies}개 · 기존 회사 업데이트{" "}
            {result.updated_companies}개 · 추가 표기 {result.added_names}개 ·
            건너뜀 {result.skipped_rows}행
          </p>
          {!result.valid && (
            <p className="error-text">
              오류가 있는 행을 수정한 뒤 파일을 다시 선택해 주세요. 전체 등록이
              취소됩니다.
            </p>
          )}
          <div className="table-scroll">
            <table>
              <caption className="import-caption">
                회사 일괄 등록 {committed ? "결과" : "미리보기"}
              </caption>
              <thead>
                <tr>
                  <th>행</th>
                  <th>회사 이름</th>
                  <th>입력 표기</th>
                  <th>대상 회사</th>
                  <th>처리</th>
                  <th>추가 표기</th>
                  <th>오류</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.name || "-"}</td>
                    <td>{row.names.join(", ") || "-"}</td>
                    <td>
                      {row.target_name ?? "-"}
                      {row.company_id !== null && ` (#${row.company_id})`}
                    </td>
                    <td>
                      <span className={`tag import-action-${row.action}`}>
                        {ACTION_LABELS[row.action]}
                      </span>
                    </td>
                    <td>{row.added_names.join(", ") || "-"}</td>
                    <td className="error-text">
                      {row.errors.length ? (
                        <ul>
                          {row.errors.map((message, index) => (
                            <li key={index}>{message}</li>
                          ))}
                        </ul>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
