import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  errorMessage,
  formatDateTime,
  PageResponse,
  REQUEST_BASE_PATH,
  REQUEST_STATUS_LABELS,
} from "../lib/coffee-chat";
import {
  BUSINESS_CARD_PATH,
  OAUTH_PROVIDER_LABELS,
  USER_BASE_PATH,
  USER_STATUS_LABELS,
  USER_TYPE_LABELS,
  UserContact,
  UserDetail,
  userDisplayName,
  WITHDRAWAL_STATE_LABELS,
} from "../lib/users";
import { CoffeeChatRequest } from "./CoffeeChatRequestsPage";
import { Pagination } from "./Pagination";

const join = (values: string[] | null) =>
  values && values.length > 0 ? values.join(", ") : "-";

export function UserDetailPage() {
  const { pk } = useParams();
  // 다른 회원으로 이동하면 열어 둔 연락처 · 명함이 남지 않도록 key로 상태를 초기화
  return <UserDetailView key={pk} pk={pk ?? ""} />;
}

function UserDetailView({ pk }: { pk: string }) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .get<UserDetail>(`${USER_BASE_PATH}/${pk}`)
      .then((detail) => {
        if (!stale) setUser(detail);
      })
      .catch((err: unknown) => {
        if (!stale) setError(errorMessage(err, "회원을 불러오지 못했습니다."));
      });
    return () => {
      stale = true;
    };
  }, [pk]);

  return (
    <>
      <div className="page-header">
        <h2>회원 상세</h2>
      </div>
      <p>
        <Link to="/users">목록으로</Link>
      </p>

      {error && !user && <p className="error-text">{error}</p>}
      {!user && !error && <p className="placeholder">불러오는 중...</p>}

      {user && (
        <>
          <BasicInfo user={user} />
          <OauthAccounts user={user} />
          {user.student && <StudentProfile user={user} />}
          {user.graduated && <GraduatedProfile user={user} />}
          <Contact user={user} />
          <Consents user={user} />
          <CoffeeChatRequests user={user} />
        </>
      )}
    </>
  );
}

function BasicInfo({ user }: { user: UserDetail }) {
  return (
    <div className="card">
      <dl className="detail-list">
        <dt>pk</dt>
        <dd>
          <code>{user.pk}</code>
        </dd>
        <dt>이름</dt>
        <dd>{userDisplayName(user)}</dd>
        <dt>이메일</dt>
        <dd>{user.email ?? "-"}</dd>
        <dt>유형</dt>
        <dd>{USER_TYPE_LABELS[user.type]}</dd>
        <dt>가입 상태</dt>
        <dd>{USER_STATUS_LABELS[user.status]}</dd>
        <dt>탈퇴 상태</dt>
        <dd>
          {WITHDRAWAL_STATE_LABELS[user.withdrawal_state]}
          {user.withdraw_requested_at &&
            ` (요청 ${formatDateTime(user.withdraw_requested_at)})`}
        </dd>
        <dt>가입일</dt>
        <dd>{formatDateTime(user.created_at)}</dd>
        <dt>수정일</dt>
        <dd>{formatDateTime(user.updated_at)}</dd>
        <dt>최근 활동</dt>
        <dd>{formatDateTime(user.last_active_at)}</dd>
      </dl>
    </div>
  );
}

function OauthAccounts({ user }: { user: UserDetail }) {
  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>로그인 계정</h2>
      </div>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>제공자</th>
                <th>이메일</th>
                <th>연결일</th>
                <th>마지막 로그인</th>
              </tr>
            </thead>
            <tbody>
              {user.oauth_accounts.map((account) => (
                <tr key={account.provider}>
                  <td>{OAUTH_PROVIDER_LABELS[account.provider]}</td>
                  <td>{account.email ?? "-"}</td>
                  <td>{formatDateTime(account.created_at)}</td>
                  <td>{formatDateTime(account.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {user.oauth_accounts.length === 0 && (
          <p className="placeholder">연결된 로그인 계정이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

function StudentProfile({ user }: { user: UserDetail }) {
  const student = user.student;
  if (!student) return null;
  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>재학생 프로필</h2>
      </div>
      <div className="card">
        <dl className="detail-list">
          <dt>학교 이메일</dt>
          <dd>{student.school_email ?? "-"}</dd>
          <dt>인증 시각</dt>
          <dd>{formatDateTime(student.verified_at)}</dd>
          <dt>학교</dt>
          <dd>{student.school ?? "-"}</dd>
          <dt>학과</dt>
          <dd>{student.department ?? "-"}</dd>
          <dt>관심 분야</dt>
          <dd>{join(student.interests)}</dd>
          <dt>참여 활동</dt>
          <dd>{join(student.activities)}</dd>
        </dl>
      </div>
    </section>
  );
}

function GraduatedProfile({ user }: { user: UserDetail }) {
  const graduated = user.graduated;
  const [card, setCard] = useState<{ url: string; expiresIn: number } | null>(
    null,
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!graduated) return null;

  // 열람 기록이 남고 URL은 만료가 짧으므로 버튼을 눌렀을 때만 받음
  const handleOpen = async () => {
    setLoading(true);
    setError(null);
    setCard(null);
    setImageFailed(false);
    try {
      const { url, expires_in } = await api.get<{
        url: string;
        expires_in: number;
      }>(`${BUSINESS_CARD_PATH}/${graduated.graduated_pk}`);
      setCard({ url, expiresIn: expires_in });
    } catch (err) {
      setError(errorMessage(err, "명함을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>현업자 프로필</h2>
      </div>
      <div className="card">
        <dl className="detail-list">
          <dt>닉네임</dt>
          <dd>{graduated.nickname ?? "-"}</dd>
          <dt>회사</dt>
          <dd>{graduated.company ?? "-"}</dd>
          <dt>부서</dt>
          <dd>{graduated.department ?? "-"}</dd>
          <dt>직무</dt>
          <dd>{graduated.job ?? "-"}</dd>
          <dt>해시태그</dt>
          <dd>{join(graduated.hashtags)}</dd>
          <dt>링크</dt>
          <dd>{join(graduated.links)}</dd>
          <dt>명함</dt>
          <dd>
            {graduated.has_business_card ? "있음" : "없음"} · 인증{" "}
            {graduated.verified_at
              ? formatDateTime(graduated.verified_at)
              : "미인증"}
            {graduated.has_business_card && (
              <>
                {" "}
                <button
                  className="button secondary small"
                  disabled={loading}
                  onClick={() => void handleOpen()}
                >
                  명함 보기
                </button>
              </>
            )}
          </dd>
        </dl>
        {graduated.has_business_card && (
          <p className="placeholder">명함을 볼 때마다 열람 기록이 남습니다.</p>
        )}
        {error && <p className="error-text">{error}</p>}
        {card && (
          <div className="business-card-viewer">
            <div className="business-card-viewer-header">
              <strong>명함</strong>
              <button
                className="button secondary small"
                onClick={() => setCard(null)}
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
                src={card.url}
                alt="명함"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            )}
            <p className="placeholder">
              <a href={card.url} target="_blank" rel="noreferrer">
                새 탭에서 열기
              </a>{" "}
              (링크는 {card.expiresIn}초 뒤 만료됩니다)
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Contact({ user }: { user: UserDetail }) {
  const methods = user.contact_methods;
  const [contact, setContact] = useState<UserContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 연락처 값은 조회할 때마다 열람 기록이 남으므로 버튼을 눌렀을 때만 받음
  const handleShow = async () => {
    setLoading(true);
    setError(null);
    try {
      setContact(
        await api.get<UserContact>(`${USER_BASE_PATH}/${user.pk}/contact`),
      );
    } catch (err) {
      setError(errorMessage(err, "연락처를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  };

  const canShow = !!methods && (methods.kakao_enabled || methods.email_enabled);

  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>커피챗 연락수단</h2>
      </div>
      <div className="card">
        {!methods ? (
          <p className="placeholder">
            입력한 연락수단이 없습니다. (가입 중이거나 탈퇴 처리된 회원)
          </p>
        ) : (
          <dl className="detail-list">
            <dt>카카오 알림톡</dt>
            <dd>
              {methods.kakao_enabled ? "받음" : "받지 않음"}
              {contact?.phone && ` · ${contact.phone}`}
            </dd>
            <dt>이메일</dt>
            <dd>
              {methods.email_enabled ? "받음" : "받지 않음"}
              {contact?.email && ` · ${contact.email}`}
            </dd>
          </dl>
        )}
        {canShow && (
          <p>
            {contact ? (
              <button
                className="button secondary small"
                onClick={() => setContact(null)}
              >
                연락처 숨기기
              </button>
            ) : (
              <button
                className="button secondary small"
                disabled={loading}
                onClick={() => void handleShow()}
              >
                연락처 보기
              </button>
            )}
          </p>
        )}
        {canShow && (
          <p className="placeholder">
            연락처를 볼 때마다 열람 기록이 남습니다.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </section>
  );
}

function Consents({ user }: { user: UserDetail }) {
  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>약관 동의 이력</h2>
      </div>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>약관</th>
                <th>버전</th>
                <th>동의 시각</th>
                <th>철회 시각</th>
              </tr>
            </thead>
            <tbody>
              {user.consents.map((consent) => (
                <tr
                  key={`${consent.type}/${consent.version}/${consent.agreed_at}`}
                >
                  <td>{consent.type}</td>
                  <td>{consent.version}</td>
                  <td>{formatDateTime(consent.agreed_at)}</td>
                  <td>{formatDateTime(consent.revoked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {user.consents.length === 0 && (
          <p className="placeholder">동의 이력이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

// 새 API 없이 커피챗 요청 목록 API의 student_pk · graduated_pk 필터를 씀
function CoffeeChatRequests({ user }: { user: UserDetail }) {
  const isStudent = user.type === "student";
  const memberPk = isStudent
    ? user.student?.student_pk
    : user.graduated?.graduated_pk;
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PageResponse<CoffeeChatRequest> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberPk) return;
    let stale = false;
    const query = new URLSearchParams({
      [isStudent ? "student_pk" : "graduated_pk"]: memberPk,
      page: String(page),
    });
    api
      .get<PageResponse<CoffeeChatRequest>>(
        `${REQUEST_BASE_PATH}?${query.toString()}`,
      )
      .then((data) => {
        if (stale) return;
        setResult(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!stale) {
          setError(errorMessage(err, "커피챗 요청을 불러오지 못했습니다."));
        }
      });
    return () => {
      stale = true;
    };
  }, [memberPk, isStudent, page]);

  return (
    <section className="detail-section">
      <div className="page-header">
        <h2>
          {isStudent ? "보낸" : "받은"} 커피챗 요청 (
          {user.coffee_chat_request_count}건)
        </h2>
      </div>
      <div className="card">
        {error && <p className="error-text">{error}</p>}
        {memberPk ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>요청 시각</th>
                    <th>상태</th>
                    <th>{isStudent ? "현업자" : "재학생"}</th>
                    <th>열람 시각</th>
                    <th>공유 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.items.map((request) => (
                    <tr key={request.pk}>
                      <td>
                        <Link to={`/coffee-chats/${request.pk}`}>
                          {formatDateTime(request.created_at)}
                        </Link>
                      </td>
                      <td>{REQUEST_STATUS_LABELS[request.status]}</td>
                      <td>
                        {isStudent ? (
                          <>
                            {request.graduated.nickname}
                            {!request.graduated.active && " · 탈퇴"} /{" "}
                            {request.graduated.company}
                          </>
                        ) : (
                          <>
                            {request.student.name ?? "(이름 삭제됨)"}
                            {!request.student.active && " · 탈퇴"} /{" "}
                            {request.student.department}
                          </>
                        )}
                      </td>
                      <td>{formatDateTime(request.graduated_viewed_at)}</td>
                      <td>{formatDateTime(request.contact_shared_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result && !error && <p className="placeholder">불러오는 중...</p>}
            {result?.total === 0 && (
              <p className="placeholder">커피챗 요청이 없습니다.</p>
            )}
            {result && result.total > 0 && (
              <Pagination
                page={result.page}
                size={result.size}
                total={result.total}
                onChange={setPage}
              />
            )}
          </>
        ) : (
          <p className="placeholder">
            추가 정보를 입력하지 않아 커피챗 요청이 없습니다.
          </p>
        )}
      </div>
    </section>
  );
}
