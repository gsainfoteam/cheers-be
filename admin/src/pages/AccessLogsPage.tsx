import {
  ACCESS_LOG_PATH,
  ACCESS_TARGET_TYPE_LABELS,
  AccessLogItem,
} from "../lib/audit-log";
import { useCurrentManager } from "../lib/current-manager";
import { formatDateTime } from "../lib/format";
import { usePagedList } from "../lib/use-paged-list";
import { Pagination } from "./Pagination";

const FILTER_KEYS = ["admin_email", "target_type"];

export function AccessLogsPage() {
  const me = useCurrentManager();

  return (
    <>
      <div className="page-header">
        <h2>접근 로그</h2>
      </div>
      {me.role === "superadmin" ? (
        <AccessLogList />
      ) : (
        <p className="placeholder">superadmin만 볼 수 있습니다.</p>
      )}
    </>
  );
}

// 목록을 조회하는 훅이 들어 있어, superadmin이 아니면 요청 자체를 보내지 않도록 따로 둠
function AccessLogList() {
  const { params, result, error, search, goToPage, formKey } =
    usePagedList<AccessLogItem>(
      ACCESS_LOG_PATH,
      FILTER_KEYS,
      "접근 로그를 불러오지 못했습니다.",
    );
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
        <select
          name="target_type"
          defaultValue={read("target_type")}
          aria-label="종류"
        >
          <option value="">전체 종류</option>
          {Object.entries(ACCESS_TARGET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
                <th>종류</th>
                <th>대상 ID</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((log) => (
                <tr key={log.pk}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{log.admin_email}</td>
                  <td>
                    {ACCESS_TARGET_TYPE_LABELS[log.target_type] ??
                      log.target_type}
                  </td>
                  <td>{log.target_id}</td>
                </tr>
              ))}
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
