import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  CHANNEL_LABELS,
  errorMessage,
  EVENT_LABELS,
  formatDateTime,
  LOG_STATUS_LABELS,
  NotificationLog,
  REQUEST_BASE_PATH,
  REQUEST_STATUS_LABELS,
} from "../lib/coffee-chat";
import { CoffeeChatRequest } from "./CoffeeChatRequestsPage";

type CoffeeChatRequestDetail = CoffeeChatRequest & {
  message: string | null;
  student_viewed_at: string | null;
  notifications: NotificationLog[];
};

export function CoffeeChatRequestDetailPage() {
  const { pk } = useParams();
  const [request, setRequest] = useState<CoffeeChatRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .get<CoffeeChatRequestDetail>(`${REQUEST_BASE_PATH}/${pk ?? ""}`)
      .then((detail) => {
        if (!stale) setRequest(detail);
      })
      .catch((err: unknown) => {
        if (!stale) setError(errorMessage(err, "요청을 불러오지 못했습니다."));
      });
    return () => {
      stale = true;
    };
  }, [pk]);

  return (
    <>
      <div className="page-header">
        <h2>커피챗 요청 상세</h2>
      </div>
      <p>
        <Link to="/coffee-chats">목록으로</Link>
      </p>

      {error && <p className="error-text">{error}</p>}
      {!request && !error && <p className="placeholder">불러오는 중...</p>}

      {request && (
        <>
          <div className="card">
            <dl className="detail-list">
              <dt>상태</dt>
              <dd>{REQUEST_STATUS_LABELS[request.status]}</dd>
              <dt>재학생</dt>
              <dd>
                {request.student.name ?? "(이름 삭제됨)"}
                {!request.student.active && " · 탈퇴"} /{" "}
                {request.student.department} ·{" "}
                <Link to={`/coffee-chats?student_pk=${request.student.pk}`}>
                  이 재학생의 요청
                </Link>
              </dd>
              <dt>현업자</dt>
              <dd>
                {request.graduated.nickname}
                {!request.graduated.active && " · 탈퇴"} /{" "}
                {request.graduated.company} · {request.graduated.job} ·{" "}
                <Link to={`/coffee-chats?graduated_pk=${request.graduated.pk}`}>
                  이 현업자의 요청
                </Link>
              </dd>
              <dt>요청 메시지</dt>
              <dd className="pre-wrap">{request.message ?? "-"}</dd>
              <dt>요청 시각</dt>
              <dd>{formatDateTime(request.created_at)}</dd>
              <dt>현업자 열람</dt>
              <dd>{formatDateTime(request.graduated_viewed_at)}</dd>
              <dt>연락처 공유</dt>
              <dd>{formatDateTime(request.contact_shared_at)}</dd>
              <dt>재학생 확인</dt>
              <dd>{formatDateTime(request.student_viewed_at)}</dd>
            </dl>
          </div>

          <div className="page-header">
            <h2>알림 발송 결과</h2>
          </div>
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
                  </tr>
                </thead>
                <tbody>
                  {request.notifications.map((log) => (
                    <tr key={log.pk}>
                      <td>{formatDateTime(log.created_at)}</td>
                      <td>{EVENT_LABELS[log.event]}</td>
                      <td>{CHANNEL_LABELS[log.channel]}</td>
                      <td>{LOG_STATUS_LABELS[log.status]}</td>
                      <td className="pre-wrap">{log.error ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {request.notifications.length === 0 && (
              <p className="placeholder">발송 기록이 없습니다.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
