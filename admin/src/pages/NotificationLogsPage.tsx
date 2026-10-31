import { Link } from "react-router-dom";
import {
  CHANNEL_LABELS,
  EVENT_LABELS,
  formatDateTime,
  LOG_STATUS_LABELS,
  NOTIFICATION_LOG_PATH,
  NotificationLog,
} from "../lib/coffee-chat";
import { usePagedList } from "../lib/use-paged-list";
import { Pagination } from "./Pagination";

type NotificationLogItem = NotificationLog & {
  coffee_chat_request_pk: string;
};

const FILTER_KEYS = ["status", "channel", "event"];

export function NotificationLogsPage() {
  const { params, result, error, search, goToPage, formKey } =
    usePagedList<NotificationLogItem>(
      NOTIFICATION_LOG_PATH,
      FILTER_KEYS,
      "발송 결과를 불러오지 못했습니다.",
    );
  const read = (key: string) => params.get(key) ?? "";

  return (
    <>
      <div className="page-header">
        <h2>알림 발송 결과</h2>
      </div>

      <form key={formKey} className="inline-form" onSubmit={search}>
        <select name="status" defaultValue={read("status")} aria-label="결과">
          <option value="">전체 결과</option>
          {Object.entries(LOG_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="channel" defaultValue={read("channel")} aria-label="채널">
          <option value="">전체 채널</option>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="event" defaultValue={read("event")} aria-label="알림">
          <option value="">전체 알림</option>
          {Object.entries(EVENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={read("from")}
          aria-label="발송일 시작"
        />
        <input
          type="date"
          name="to"
          defaultValue={read("to")}
          aria-label="발송일 끝"
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
                <th>발송 시각</th>
                <th>알림</th>
                <th>채널</th>
                <th>결과</th>
                <th>실패 사유</th>
                <th>요청</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((log) => (
                <tr key={log.pk}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{EVENT_LABELS[log.event]}</td>
                  <td>{CHANNEL_LABELS[log.channel]}</td>
                  <td>{LOG_STATUS_LABELS[log.status]}</td>
                  <td className="pre-wrap">{log.error ?? "-"}</td>
                  <td>
                    <Link to={`/coffee-chats/${log.coffee_chat_request_pk}`}>
                      상세
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result && !error && <p className="placeholder">불러오는 중...</p>}
        {result?.total === 0 && (
          <p className="placeholder">조건에 맞는 발송 기록이 없습니다.</p>
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
