import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/coffee-chat";
import { usePagedList } from "../lib/use-paged-list";
import {
  affiliationLabel,
  USER_BASE_PATH,
  USER_STATUS_LABELS,
  USER_TYPE_LABELS,
  UserListItem,
  userDisplayName,
  WITHDRAWAL_STATE_LABELS,
} from "../lib/users";
import { Pagination } from "./Pagination";

const FILTER_KEYS = ["type", "status", "withdrawal", "q"];

// 36자 uuid가 표를 너무 넓게 만들어 앞 · 뒤만 보여 줌. 시드 데이터처럼 앞이 같은 pk도 구분되도록 뒤도 남기고,
// 전체 값은 마우스를 올리면 title로, 상세 화면에서는 그대로 보임. 검색은 전체 pk의 일부로도 됨
const shortPk = (pk: string) => `${pk.slice(0, 8)}…${pk.slice(-4)}`;

export function UsersPage() {
  const { params, result, error, search, goToPage, formKey } =
    usePagedList<UserListItem>(
      USER_BASE_PATH,
      FILTER_KEYS,
      "회원 목록을 불러오지 못했습니다.",
    );
  const read = (key: string) => params.get(key) ?? "";

  return (
    <>
      <div className="page-header">
        <h2>회원</h2>
      </div>

      <form key={formKey} className="inline-form" onSubmit={search}>
        <select name="type" defaultValue={read("type")} aria-label="유형">
          <option value="">전체 유형</option>
          {Object.entries(USER_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={read("status")}
          aria-label="가입 상태"
        >
          <option value="">전체 가입 상태</option>
          {Object.entries(USER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="withdrawal"
          defaultValue={read("withdrawal")}
          aria-label="탈퇴 상태"
        >
          <option value="">전체 탈퇴 상태</option>
          {Object.entries(WITHDRAWAL_STATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={read("from")}
          aria-label="가입일 시작"
        />
        <input
          type="date"
          name="to"
          defaultValue={read("to")}
          aria-label="가입일 끝"
        />
        <input
          name="q"
          defaultValue={read("q")}
          maxLength={255}
          placeholder="pk · 이름 · 이메일"
          aria-label="검색어"
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
                <th>pk</th>
                <th>이름</th>
                <th>이메일</th>
                <th>유형</th>
                <th>가입 상태</th>
                <th>탈퇴 상태</th>
                <th>소속</th>
                <th>가입일</th>
                <th>최근 활동</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((user) => (
                <tr key={user.pk}>
                  <td>
                    <Link to={`/users/${user.pk}`} title={user.pk}>
                      <code className="pk-short">{shortPk(user.pk)}</code>
                    </Link>
                  </td>
                  <td>{userDisplayName(user)}</td>
                  <td>{user.email ?? "-"}</td>
                  <td>{USER_TYPE_LABELS[user.type]}</td>
                  <td>{USER_STATUS_LABELS[user.status]}</td>
                  <td>{WITHDRAWAL_STATE_LABELS[user.withdrawal_state]}</td>
                  <td>{affiliationLabel(user.type, user.affiliation)}</td>
                  <td>{formatDateTime(user.created_at)}</td>
                  <td>{formatDateTime(user.last_active_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result && !error && <p className="placeholder">불러오는 중...</p>}
        {result?.total === 0 && (
          <p className="placeholder">조건에 맞는 회원이 없습니다.</p>
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
