import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useCurrentManager } from "../lib/current-manager";
import { errorMessage, formatDateTime } from "../lib/format";
import { Pagination } from "./Pagination";

const BASE_PATH = "/api/manager/v1/dev/user";
const PAGE_SIZE = 20;

type DevUserStatus =
  | "pending"
  | "active"
  | "withdrawal_requested"
  | "withdrawn";

type DevUser = {
  user_pk: string;
  type: "student" | "graduated";
  status: DevUserStatus;
  name: string | null;
  email: string | null;
  created_at: string;
};

type DevUserPage = {
  items: DevUser[];
  page: number;
  size: number;
  total: number;
};

const TYPE_LABELS: Record<DevUser["type"], string> = {
  student: "재학생",
  graduated: "현업자",
};

const STATUS_LABELS: Record<DevUserStatus, string> = {
  pending: "가입 중",
  active: "가입 완료",
  withdrawal_requested: "탈퇴 유예",
  withdrawn: "탈퇴 처리 완료",
};

// 개발 · QA용. 탈퇴 유예 없이 바로 지워 같은 계정으로 다시 가입해 볼 수 있게 함 (staging에서만 메뉴가 보임)
export function DevUserDeletePage() {
  const me = useCurrentManager();
  const isSuperAdmin = me.role === "superadmin";

  const [page, setPage] = useState(1);
  const [data, setData] = useState<DevUserPage | null>(null);
  const [target, setTarget] = useState<DevUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<DevUserPage>(`${BASE_PATH}?page=${page}&size=${PAGE_SIZE}`)
        .then(setData),
    [page],
  );

  useEffect(() => {
    if (!isSuperAdmin) return;
    load().catch((err: unknown) =>
      setError(
        err instanceof ApiError && err.status === 404
          ? "이 환경에서는 완전탈퇴를 사용할 수 없습니다. (서버의 DEV_USER_DELETE_ENABLED가 꺼져 있음)"
          : errorMessage(err, "회원 목록을 불러오지 못했습니다."),
      ),
    );
  }, [isSuperAdmin, load]);

  const handleDelete = async (user: DevUser) => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`${BASE_PATH}/${user.user_pk}`);
      setTarget(null);
      setNotice(`${displayName(user)} 계정을 완전히 삭제했습니다.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, "삭제하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <>
        <div className="page-header">
          <h2>완전탈퇴 (개발용)</h2>
        </div>
        <p className="placeholder">superadmin만 사용할 수 있습니다.</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>완전탈퇴 (개발용)</h2>
      </div>

      <p className="placeholder">
        탈퇴 유예기간 없이 회원과 가입 정보 · 커피챗 요청(상대방 기록 포함) ·
        첨부 · 명함 파일을 바로 지웁니다. 같은 Google 계정으로 처음부터 다시
        가입할 수 있습니다. 되돌릴 수 없습니다.
      </p>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="placeholder">{notice}</p>}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>유형</th>
                <th>상태</th>
                <th>가입 시각</th>
                <th aria-label="관리" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((user) => (
                <tr key={user.user_pk}>
                  <td>{user.name ?? "-"}</td>
                  <td>{user.email ?? "-"}</td>
                  <td>{TYPE_LABELS[user.type]}</td>
                  <td>{STATUS_LABELS[user.status]}</td>
                  <td>{formatDateTime(user.created_at)}</td>
                  <td className="row-actions">
                    <button
                      className="button danger small"
                      disabled={submitting}
                      onClick={() => setTarget(user)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data && !error && <p className="placeholder">불러오는 중...</p>}
        {data?.items.length === 0 && (
          <p className="placeholder">회원이 없습니다.</p>
        )}
        {data && (
          <Pagination
            page={page}
            size={data.size}
            total={data.total}
            onChange={setPage}
          />
        )}
      </div>

      {target && (
        <div
          className="modal-backdrop"
          onClick={() => !submitting && setTarget(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dev-user-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="dev-user-delete-title">정말 삭제할까요?</h3>
            <dl className="detail-list">
              <dt>이름</dt>
              <dd>{target.name ?? "-"}</dd>
              <dt>이메일</dt>
              <dd>{target.email ?? "-"}</dd>
              <dt>유형 · 상태</dt>
              <dd>
                {TYPE_LABELS[target.type]} · {STATUS_LABELS[target.status]}
              </dd>
              <dt>user pk</dt>
              <dd>{target.user_pk}</dd>
            </dl>
            <p className="placeholder">
              이 회원의 데이터와 이 회원이 주고받은 커피챗 요청이 모두
              삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={submitting}
                onClick={() => setTarget(null)}
              >
                취소
              </button>
              <button
                className="button danger"
                disabled={submitting}
                onClick={() => void handleDelete(target)}
              >
                {submitting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function displayName(user: DevUser): string {
  return user.name ?? user.email ?? user.user_pk;
}
