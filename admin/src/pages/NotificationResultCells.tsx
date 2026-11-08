import { useState } from "react";
import { api } from "../lib/api";
import {
  canLookupDelivery,
  DeliveryLookup,
  errorMessage,
  formatDateTime,
  logResultLabel,
  NOTIFICATION_LOG_PATH,
  NotificationLog,
} from "../lib/coffee-chat";

// 결과 · 사유 · 알리고 mid 칸. 알림톡은 버튼으로 알리고에 바로 카카오 결과를 조회하고 그 행만 바꿔 보여 줌 (CRB-77)
type LookupState = {
  // 조회를 시작할 때의 log. 목록을 다시 불러와 log가 바뀌면 이 상태는 버림
  from: NotificationLog;
  log?: NotificationLog;
  notice?: string;
  error?: string;
};

export function NotificationResultCells({ log }: { log: NotificationLog }) {
  const [looking, setLooking] = useState(false);
  const [state, setState] = useState<LookupState | null>(null);
  const lookupState = state?.from === log ? state : null;
  const current = lookupState?.log ?? log;

  const lookup = async () => {
    setLooking(true);
    setState({ from: log });
    try {
      const res = await api.post<DeliveryLookup>(
        `${NOTIFICATION_LOG_PATH}/${log.pk}/delivery-lookup`,
        {},
      );
      setState({
        from: log,
        log: res.log,
        notice:
          res.lookup === "pending"
            ? "아직 전송 중입니다. 알리고는 최대 24시간까지 시도합니다."
            : undefined,
      });
    } catch (err) {
      setState({
        from: log,
        log: lookupState?.log,
        error: errorMessage(err, "알리고 결과를 조회하지 못했습니다."),
      });
    } finally {
      setLooking(false);
    }
  };

  // 도달한 건은 사유가 없음 (알리고는 성공에도 코드 · 메시지를 줌)
  const deliveryReason =
    current.delivery_status === "delivered"
      ? ""
      : [current.delivery_code, current.delivery_message]
          .filter(Boolean)
          .join(" ");
  const isAlimtalk = current.channel === "kakao_alimtalk";

  return (
    <>
      <td>
        {logResultLabel(current)}
        {canLookupDelivery(current) && (
          <div>
            <button
              type="button"
              className="button secondary small"
              onClick={lookup}
              disabled={looking}
            >
              {looking ? "조회 중..." : "알리고 결과 조회"}
            </button>
          </div>
        )}
        {lookupState?.notice && (
          <div className="placeholder">{lookupState.notice}</div>
        )}
        {lookupState?.error && (
          <div className="error-text">{lookupState.error}</div>
        )}
      </td>
      <td className="pre-wrap">
        {current.error ?? (deliveryReason || "-")}
        {current.delivery_reported_at && (
          <div className="placeholder">
            결과 시각 {formatDateTime(current.delivery_reported_at)}
          </div>
        )}
      </td>
      <td>{(isAlimtalk && current.provider_message_id) || "-"}</td>
    </>
  );
}
