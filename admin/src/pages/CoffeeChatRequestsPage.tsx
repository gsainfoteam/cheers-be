import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  dayStart,
  errorMessage,
  formatDateTime,
  PageResponse,
  REQUEST_BASE_PATH,
  REQUEST_STATUS_LABELS,
} from "../lib/coffee-chat";
import { Pagination } from "./Pagination";

export type CoffeeChatRequest = {
  pk: string;
  status: keyof typeof REQUEST_STATUS_LABELS;
  student: {
    pk: string;
    name: string | null;
    department: string;
    active: boolean;
  };
  graduated: {
    pk: string;
    nickname: string;
    company: string;
    job: string;
    active: boolean;
  };
  created_at: string;
  graduated_viewed_at: string | null;
  contact_shared_at: string | null;
};

// 상세 화면의 "이 재학생 · 현업자의 요청" 링크가 URL로 넘기는 값. 탈퇴 처리로 이름이 지워져도 찾을 수 있음
const PK_FILTERS = ["student_pk", "graduated_pk"] as const;

// 필터와 페이지를 URL에 두어 상세 화면에서 돌아와도 유지됨
function toApiQuery(params: URLSearchParams): string {
  const query = new URLSearchParams({ page: params.get("page") ?? "1" });
  for (const key of [
    "status",
    "student_name",
    "graduated_nickname",
    ...PK_FILTERS,
  ]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from) query.set("created_from", dayStart(from));
  if (to) query.set("created_to", dayStart(to, 1));
  return query.toString();
}

export function CoffeeChatRequestsPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => readFilters(params));
  const [result, setResult] = useState<PageResponse<CoffeeChatRequest> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const apiQuery = toApiQuery(params);
  useEffect(() => {
    let stale = false;
    api
      .get<PageResponse<CoffeeChatRequest>>(`${REQUEST_BASE_PATH}?${apiQuery}`)
      .then((page) => {
        if (stale) return;
        setResult(page);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!stale) {
          setResult(null);
          setError(errorMessage(err, "요청 목록을 불러오지 못했습니다."));
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
      if (value.trim()) next.set(key, value.trim());
    }
    setParams(next);
  };

  const handlePage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };

  const pkFilter = PK_FILTERS.find((key) => params.get(key));

  return (
    <>
      <div className="page-header">
        <h2>커피챗 요청</h2>
      </div>

      <form className="inline-form" onSubmit={handleSearch}>
        <select
          value={draft.status}
          aria-label="상태"
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">전체 상태</option>
          {Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={draft.from}
          aria-label="요청일 시작"
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <input
          type="date"
          value={draft.to}
          aria-label="요청일 끝"
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <input
          value={draft.student_name}
          maxLength={64}
          placeholder="재학생 이름"
          aria-label="재학생 이름"
          onChange={(e) => setDraft({ ...draft, student_name: e.target.value })}
        />
        <input
          value={draft.graduated_nickname}
          maxLength={32}
          placeholder="현업자 닉네임"
          aria-label="현업자 닉네임"
          onChange={(e) =>
            setDraft({ ...draft, graduated_nickname: e.target.value })
          }
        />
        <button className="button small" type="submit">
          검색
        </button>
      </form>

      {pkFilter && (
        <p className="placeholder">
          {pkFilter === "student_pk" ? "한 재학생" : "한 현업자"}의 요청만 보는
          중입니다. 검색하면 해제됩니다.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>요청 시각</th>
                <th>상태</th>
                <th>재학생</th>
                <th>현업자</th>
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
                    {request.student.name ?? "(이름 삭제됨)"}
                    {!request.student.active && " · 탈퇴"} /{" "}
                    {request.student.department}
                  </td>
                  <td>
                    {request.graduated.nickname}
                    {!request.graduated.active && " · 탈퇴"} /{" "}
                    {request.graduated.company}
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
          <p className="placeholder">조건에 맞는 요청이 없습니다.</p>
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

function readFilters(params: URLSearchParams) {
  const read = (key: string) => params.get(key) ?? "";
  return {
    status: read("status"),
    from: read("from"),
    to: read("to"),
    student_name: read("student_name"),
    graduated_nickname: read("graduated_nickname"),
  };
}
