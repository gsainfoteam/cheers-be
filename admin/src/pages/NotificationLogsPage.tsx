import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  CHANNEL_LABELS,
  dayStart,
  errorMessage,
  EVENT_LABELS,
  formatDateTime,
  LOG_STATUS_LABELS,
  NOTIFICATION_LOG_PATH,
  NotificationLog,
  PageResponse,
} from "../lib/coffee-chat";
import { Pagination } from "./Pagination";

type NotificationLogItem = NotificationLog & {
  coffee_chat_request_pk: string;
};

// 필터와 페이지를 URL에 두어 요청 상세에서 돌아와도 유지됨
function toApiQuery(params: URLSearchParams): string {
  const query = new URLSearchParams({ page: params.get("page") ?? "1" });
  for (const key of ["status", "channel", "event"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from) query.set("created_from", dayStart(from));
  if (to) query.set("created_to", dayStart(to, 1));
  return query.toString();
}

export function NotificationLogsPage() {
  const [params, setParams] = useSearchParams();
  const read = (key: string) => params.get(key) ?? "";
  const [draft, setDraft] = useState({
    status: read("status"),
    channel: read("channel"),
    event: read("event"),
    from: read("from"),
    to: read("to"),
  });
  const [result, setResult] =
    useState<PageResponse<NotificationLogItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiQuery = toApiQuery(params);
  useEffect(() => {
    let stale = false;
    api
      .get<PageResponse<NotificationLogItem>>(
        `${NOTIFICATION_LOG_PATH}?${apiQuery}`,
      )
      .then((page) => {
        if (stale) return;
        setResult(page);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!stale) {
          setResult(null);
          setError(errorMessage(err, "발송 결과를 불러오지 못했습니다."));
        }
      });
    return () => {
      stale = true;
    };
  }, [apiQuery]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) {
      if (value) next.set(key, value);
    }
    setParams(next);
  };

  const handlePage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };

  return (
    <>
      <div className="page-header">
        <h2>알림 발송 결과</h2>
      </div>

      <form className="inline-form" onSubmit={handleSearch}>
        <select
          value={draft.status}
          aria-label="결과"
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">전체 결과</option>
          {Object.entries(LOG_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={draft.channel}
          aria-label="채널"
          onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
        >
          <option value="">전체 채널</option>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={draft.event}
          aria-label="알림"
          onChange={(e) => setDraft({ ...draft, event: e.target.value })}
        >
          <option value="">전체 알림</option>
          {Object.entries(EVENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={draft.from}
          aria-label="발송일 시작"
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <input
          type="date"
          value={draft.to}
          aria-label="발송일 끝"
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
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
            onChange={handlePage}
          />
        )}
      </div>
    </>
  );
}
