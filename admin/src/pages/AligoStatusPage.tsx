import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  AligoStatus,
  ALIGO_STATUS_PATH,
  ALIMTALK_TEMPLATE_PATH,
  AlimtalkTemplate,
  AlimtalkTemplateList,
  EVENT_LABELS,
  formatDateTime,
} from "../lib/coffee-chat";
import { errorMessage } from "../lib/format";

const number = (value: number) => value.toLocaleString("ko-KR");

type Draft = Pick<
  AlimtalkTemplate,
  "tpl_code" | "title" | "message" | "button_name"
>;

function TemplateForm({
  template,
  onSaved,
}: {
  template: AlimtalkTemplate;
  onSaved: (saved: AlimtalkTemplate) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    tpl_code: template.tpl_code,
    title: template.title,
    message: template.message,
    button_name: template.button_name,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof Draft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !window.confirm(
        "알리고에 등록한 템플릿과 글자 하나까지 같아야 전송됩니다. 저장할까요?",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.patch<AlimtalkTemplate>(
        `${ALIMTALK_TEMPLATE_PATH}/${template.event}`,
        draft,
      );
      onSaved(result);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "템플릿을 저장하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h3>
        {EVENT_LABELS[template.event as keyof typeof EVENT_LABELS] ??
          template.event}
      </h3>
      {!template.tpl_code && (
        <p className="error-text">
          템플릿 코드가 비어 있어 이 알림톡은 발송되지 않습니다.
        </p>
      )}
      <p className="placeholder">
        마지막 수정 {formatDateTime(template.updated_at)}
      </p>
      <label>
        템플릿 코드
        <input
          maxLength={64}
          value={draft.tpl_code}
          onChange={(e) => set("tpl_code", e.target.value)}
        />
      </label>
      <label>
        제목
        <input
          required
          maxLength={50}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label>
        본문
        <textarea
          required
          rows={5}
          maxLength={1000}
          value={draft.message}
          onChange={(e) => set("message", e.target.value)}
        />
      </label>
      <label>
        버튼 이름
        <input
          required
          maxLength={14}
          value={draft.button_name}
          onChange={(e) => set("button_name", e.target.value)}
        />
      </label>
      {error && <p className="error-text">{error}</p>}
      {saved && <p className="placeholder">저장했습니다.</p>}
      <button className="button small" type="submit" disabled={submitting}>
        저장
      </button>
    </form>
  );
}

export function AligoStatusPage() {
  const [status, setStatus] = useState<AligoStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AlimtalkTemplate[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    api
      .get<AligoStatus>(ALIGO_STATUS_PATH)
      .then((res) => {
        setStatus(res);
        setStatusError(null);
      })
      .catch((err: unknown) =>
        setStatusError(errorMessage(err, "알리고 현황을 불러오지 못했습니다.")),
      );
  }, []);

  useEffect(() => {
    loadStatus();
    api
      .get<AlimtalkTemplateList>(ALIMTALK_TEMPLATE_PATH)
      .then((res) => setTemplates(res.items))
      .catch((err: unknown) =>
        setTemplateError(
          errorMessage(err, "알림톡 템플릿을 불러오지 못했습니다."),
        ),
      );
  }, [loadStatus]);

  return (
    <>
      <div className="page-header">
        <h2>알리고 현황</h2>
        <button className="button secondary small" onClick={loadStatus}>
          새로고침
        </button>
      </div>

      {statusError && <p className="error-text">{statusError}</p>}
      {status && (
        <div className="card">
          {!status.configured && (
            <p className="placeholder">
              알리고 키가 설정되지 않아 잔여량은 조회하지 않습니다.
            </p>
          )}
          <dl className="detail-list">
            {status.balance && (
              <>
                <dt>잔여 충전금액</dt>
                <dd>
                  {status.balance.amount === null
                    ? "-"
                    : `${number(status.balance.amount)}원`}
                </dd>
                {Object.entries(status.balance.counts).map(([key, value]) => (
                  <Fragment key={key}>
                    <dt>잔여 건수 ({key})</dt>
                    <dd>{number(value)}</dd>
                  </Fragment>
                ))}
              </>
            )}
            <dt>이번 달 발송량 ({formatDateTime(status.month.since)} 이후)</dt>
            <dd>
              접수 {number(status.month.accepted)}건 · 도달{" "}
              {number(status.month.delivered)} · 실패{" "}
              {number(status.month.failed)} · 대기{" "}
              {number(status.month.pending)} · 확인 불가{" "}
              {number(status.month.unknown)}
            </dd>
            <dt>부족 알림 기준값</dt>
            <dd>
              {status.low_balance_threshold === null
                ? "꺼짐"
                : `${number(status.low_balance_threshold)} 이하`}
            </dd>
            <dt>조회 시각</dt>
            <dd>{formatDateTime(status.fetched_at)}</dd>
          </dl>
        </div>
      )}

      <div className="page-header">
        <h2>알림톡 템플릿</h2>
      </div>
      <p className="placeholder">
        알리고에 등록한 템플릿과 글자 하나까지 같아야 전송됩니다. 여기서 바꿔도
        알리고 · 카카오의 템플릿은 바뀌지 않으며, 서버마다 최대 1분 안에 발송에
        반영됩니다.
      </p>
      {templateError && <p className="error-text">{templateError}</p>}
      {templates?.map((template) => (
        <TemplateForm
          key={`${template.event}-${template.updated_at}`}
          template={template}
          onSaved={(saved) =>
            setTemplates(
              (prev) =>
                prev?.map((item) =>
                  item.event === saved.event ? saved : item,
                ) ?? null,
            )
          }
        />
      ))}
    </>
  );
}
