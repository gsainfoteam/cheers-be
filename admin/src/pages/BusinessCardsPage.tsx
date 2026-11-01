import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useCurrentManager } from "../lib/current-manager";
import { errorMessage, formatDateTime } from "../lib/format";

const BASE_PATH = "/api/manager/v1/business-card";
const PAGE_SIZE = 20;

type SignupStatus = "pending" | "active" | "withdrawal_requested";

type GraduatedCard = {
  graduated_pk: string;
  name: string | null;
  nickname: string | null;
  company: string | null;
  job: string | null;
  has_business_card: boolean;
  verified_at: string | null;
  signup_status: SignupStatus;
};

type GraduatedCardPage = {
  items: GraduatedCard[];
  page: number;
  size: number;
  total: number;
};

// 열어 둔 명함. URL은 만료가 짧고 조회마다 열람 기록이 남으므로 버튼을 눌렀을 때만 받음
type OpenedCard = {
  graduated: GraduatedCard;
  url: string;
  expiresIn: number;
};

const SIGNUP_STATUS_LABELS: Record<SignupStatus, string> = {
  pending: "가입 중",
  active: "가입 완료",
  withdrawal_requested: "탈퇴 유예",
};

function displayName(graduated: GraduatedCard): string {
  return graduated.name ?? graduated.nickname ?? "(이름 없음)";
}

export function BusinessCardsPage() {
  const me = useCurrentManager();
  const isSuperAdmin = me.role === "superadmin";

  const [page, setPage] = useState(1);
  const [data, setData] = useState<GraduatedCardPage | null>(null);
  const [opened, setOpened] = useState<OpenedCard | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<GraduatedCardPage>(`${BASE_PATH}?page=${page}&size=${PAGE_SIZE}`)
        .then(setData),
    [page],
  );

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "현업자 목록을 불러오지 못했습니다.")),
    );
  }, [load]);

  const handleOpen = async (graduated: GraduatedCard) => {
    setSubmitting(true);
    setError(null);
    setOpened(null);
    setImageFailed(false);
    try {
      const { url, expires_in } = await api.get<{
        url: string;
        expires_in: number;
      }>(`${BASE_PATH}/${graduated.graduated_pk}`);
      setOpened({ graduated, url, expiresIn: expires_in });
    } catch (err) {
      setError(errorMessage(err, "명함을 불러오지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (graduated: GraduatedCard) => {
    const confirmed = window.confirm(
      `${displayName(graduated)}님의 명함 인증을 취소할까요?\n\n` +
        "재학생 목록에서 빠지고, 재업로드할 때까지 받은 커피챗 요청을 처리할 수 없습니다. " +
        "본인에게 알림은 가지 않습니다.",
    );
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        `${BASE_PATH}/${graduated.graduated_pk}/cancel-verification`,
        {},
      );
      if (opened?.graduated.graduated_pk === graduated.graduated_pk) {
        setOpened(null);
      }
      await load();
    } catch (err) {
      setError(errorMessage(err, "인증을 취소하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <>
      <div className="page-header">
        <h2>현업자 명함</h2>
      </div>

      {error && <p className="error-text">{error}</p>}

      {opened && (
        <div className="card business-card-viewer">
          <div className="business-card-viewer-header">
            <strong>{displayName(opened.graduated)}</strong>
            <button
              className="button secondary small"
              onClick={() => setOpened(null)}
            >
              닫기
            </button>
          </div>
          {imageFailed ? (
            <p className="placeholder">
              이미지를 표시하지 못했습니다. HEIC처럼 브라우저가 지원하지 않는
              형식일 수 있습니다.
            </p>
          ) : (
            <img
              src={opened.url}
              alt={`${displayName(opened.graduated)} 명함`}
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          )}
          <p className="placeholder">
            <a href={opened.url} target="_blank" rel="noreferrer">
              새 탭에서 열기
            </a>{" "}
            (링크는 {opened.expiresIn}초 뒤 만료됩니다)
          </p>
        </div>
      )}

      <p className="placeholder">
        명함을 볼 때마다 열람 기록이 남습니다.
        {!isSuperAdmin && " 인증 취소는 superadmin만 할 수 있습니다."}
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>닉네임</th>
              <th>회사</th>
              <th>직무</th>
              <th>가입 상태</th>
              <th>명함</th>
              <th>인증 시각</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((graduated) => (
              <tr key={graduated.graduated_pk}>
                <td>{graduated.name ?? "-"}</td>
                <td>{graduated.nickname ?? "-"}</td>
                <td>{graduated.company ?? "-"}</td>
                <td>{graduated.job ?? "-"}</td>
                <td>{SIGNUP_STATUS_LABELS[graduated.signup_status]}</td>
                <td>{graduated.has_business_card ? "있음" : "없음"}</td>
                <td>
                  {graduated.verified_at
                    ? formatDateTime(graduated.verified_at)
                    : "미인증"}
                </td>
                <td className="row-actions">
                  {graduated.has_business_card && (
                    <button
                      className="button secondary small"
                      disabled={submitting}
                      onClick={() => void handleOpen(graduated)}
                    >
                      보기
                    </button>
                  )}
                  {isSuperAdmin && graduated.verified_at && (
                    <button
                      className="button danger small"
                      disabled={submitting}
                      onClick={() => void handleCancel(graduated)}
                    >
                      인증 취소
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error && <p className="placeholder">불러오는 중...</p>}
        {data?.items.length === 0 && (
          <p className="placeholder">현업자가 없습니다.</p>
        )}
        {data && (
          <div className="pagination">
            <button
              className="button secondary small"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <span>
              {page} / {lastPage}
            </span>
            <button
              className="button secondary small"
              disabled={page >= lastPage}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        )}
      </div>
    </>
  );
}
