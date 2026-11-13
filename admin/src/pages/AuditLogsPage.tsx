import { Fragment, useState } from "react";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_LOG_PATH,
  AUDIT_TARGET_TYPE_LABELS,
  AuditLogItem,
  diffSnapshots,
} from "../lib/audit-log";
import { useCurrentManager } from "../lib/current-manager";
import { formatDateTime } from "../lib/format";
import { usePagedList } from "../lib/use-paged-list";
import { Pagination } from "./Pagination";

const FILTER_KEYS = ["admin_email", "action", "target_type", "target_id"];

export function AuditLogsPage() {
  const me = useCurrentManager();

  return (
    <>
      <div className="page-header">
        <h2>감사 로그</h2>
      </div>
      {me.role === "superadmin" ? (
        <AuditLogList />
      ) : (
        <p className="placeholder">superadmin만 볼 수 있습니다.</p>
      )}
    </>
  );
}

// 목록을 조회하는 훅이 들어 있어, superadmin이 아니면 요청 자체를 보내지 않도록 따로 둠
function AuditLogList() {
  const { params, result, error, search, goToPage, formKey } =
    usePagedList<AuditLogItem>(
      AUDIT_LOG_PATH,
      FILTER_KEYS,
      "감사 로그를 불러오지 못했습니다.",
    );
  const [openPk, setOpenPk] = useState<string | null>(null);
  const read = (key: string) => params.get(key) ?? "";

  return (
    <>
      <form key={formKey} className="inline-form" onSubmit={search}>
        <input
          type="search"
          name="admin_email"
          defaultValue={read("admin_email")}
          placeholder="어드민 이메일"
          aria-label="어드민 이메일"
        />
        <select name="action" defaultValue={read("action")} aria-label="동작">
          <option value="">전체 동작</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="target_type"
          defaultValue={read("target_type")}
          aria-label="대상 종류"
        >
          <option value="">전체 대상</option>
          {Object.entries(AUDIT_TARGET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="target_id"
          defaultValue={read("target_id")}
          placeholder="대상 ID"
          aria-label="대상 ID"
        />
        <input
          type="date"
          name="from"
          defaultValue={read("from")}
          aria-label="기록일 시작"
        />
        <input
          type="date"
          name="to"
          defaultValue={read("to")}
          aria-label="기록일 끝"
        />
        <button className="button small" type="submit">
          검색
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>어드민</th>
                <th>동작</th>
                <th>대상</th>
                <th>대상 ID</th>
                <th>변경 내용</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((log) => {
                const open = openPk === log.pk;
                const hasDiff = log.before !== null || log.after !== null;
                return (
                  <Fragment key={log.pk}>
                    <tr>
                      <td>{formatDateTime(log.created_at)}</td>
                      <td>{log.admin_email}</td>
                      <td>{AUDIT_ACTION_LABELS[log.action] ?? log.action}</td>
                      <td>
                        {AUDIT_TARGET_TYPE_LABELS[log.target_type] ??
                          log.target_type}
                      </td>
                      <td>{log.target_id ?? "-"}</td>
                      <td>
                        {hasDiff ? (
                          <button
                            className="button small secondary"
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenPk(open ? null : log.pk)}
                          >
                            {open ? "접기" : "보기"}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6}>
                          <SnapshotDiff log={log} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!result && !error && <p className="placeholder">불러오는 중...</p>}
        {result?.total === 0 && (
          <p className="placeholder">조건에 맞는 기록이 없습니다.</p>
        )}
        {result && result.total > 0 && (
          <Pagination
            page={result.page}
            size={result.size}
            total={result.total}
            onChange={goToPage}
          />
        )}
      </div>
    </>
  );
}

// 생성은 변경 전이, 삭제는 변경 후가 비어 있음. 바뀐 항목을 강조
function SnapshotDiff({ log }: { log: AuditLogItem }) {
  const rows = diffSnapshots(log.before, log.after);
  return (
    <table className="diff-table">
      <thead>
        <tr>
          <th>항목</th>
          <th>변경 전</th>
          <th>변경 후</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={row.changed ? "diff-changed" : ""}>
            <td>{row.key}</td>
            <td>
              <pre>{row.before || "-"}</pre>
            </td>
            <td>
              <pre>{row.after || "-"}</pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
