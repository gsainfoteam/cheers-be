import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { api } from "../lib/api";
import { PageResponse } from "../lib/coffee-chat";
import { errorMessage } from "../lib/format";
import { CompanyImportPanel } from "./CompanyImportPanel";
import { Pagination } from "./Pagination";

const BASE_PATH = "/api/manager/v1/company";

type Company = {
  company_id: number;
  name: string;
  logo_url: string | null;
  needs_review: boolean;
  names: { name_id: number; name: string }[];
  graduated_count: number;
  created_at: string;
};

type UploadUrl = {
  url: string;
  method: "PUT";
  key: string;
  headers: Record<string, string>;
};

// GET /api/manager/v1/company/search (현업자 입력창 검색과 같은 결과)
type SearchItem = {
  company_id: number;
  name: string;
  logo_url: string | null;
  matched_name: string;
};

const LOGO_TYPES = "image/png,image/jpeg,image/webp";

// 입력을 멈춘 뒤 검색할 때까지 기다리는 시간
const SEARCH_DELAY_MS = 200;

// 쉼표나 줄바꿈으로 구분한 표기 목록
const splitNames = (value: string) =>
  value
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);

// 서버의 company_name.normalized_name 규칙과 맞춘다. 표기는 공백과 대소문자만
// 달라도 같은 것으로 취급되므로, 요청 전에 바로 이유를 알려 준다.
const normalizeCompanyName = (name: string) =>
  name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export function CompaniesPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageResponse<Company> | null>(null);
  const [newCompany, setNewCompany] = useState({ name: "", names: "" });
  const [editing, setEditing] = useState<{ pk: number; name: string } | null>(
    null,
  );
  const [addingName, setAddingName] = useState<{
    pk: number;
    name: string;
  } | null>(null);
  const [addNameNotice, setAddNameNotice] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<Company | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .get<PageResponse<Company>>(`${BASE_PATH}?page=${page}`)
      .then(setData);
  }, [page]);

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "회사 목록을 불러오지 못했습니다.")),
    );
  }, [load]);

  // 변경 후 목록을 다시 읽음. 실패하면 서버 메시지를 그대로 보여 주고, 그 사이 바뀐 목록도 다시 읽어 둠
  const mutate = async (action: () => Promise<unknown>, fallback: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      await load().catch(() => undefined);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const created = await mutate(
      () =>
        api.post(BASE_PATH, {
          name: newCompany.name.trim(),
          names: splitNames(newCompany.names),
        }),
      "회사를 등록하지 못했습니다.",
    );
    if (created) setNewCompany({ name: "", names: "" });
  };

  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const renamed = await mutate(
      () =>
        api.patch(`${BASE_PATH}/${editing.pk}`, { name: editing.name.trim() }),
      "이름을 수정하지 못했습니다.",
    );
    if (renamed) setEditing(null);
  };

  const handleApprove = (company: Company) =>
    void mutate(
      () =>
        api.patch(`${BASE_PATH}/${company.company_id}`, {
          needs_review: false,
        }),
      "승인하지 못했습니다.",
    );

  const handleAddName = async (e: FormEvent) => {
    e.preventDefault();
    if (!addingName) return;
    const company = data?.items.find(
      (item) => item.company_id === addingName.pk,
    );
    const name = addingName.name.trim();
    const existingName = [
      ...(company ? [company.name] : []),
      ...(company?.names.map((item) => item.name) ?? []),
    ].find((item) => normalizeCompanyName(item) === normalizeCompanyName(name));

    if (existingName) {
      setAddNameNotice(
        `이미 등록된 표기입니다. 대소문자와 공백은 구분하지 않으므로 “${existingName}”와 같은 표기는 추가할 수 없습니다.`,
      );
      return;
    }

    setAddNameNotice(null);
    const added = await mutate(
      () =>
        api.post(`${BASE_PATH}/${addingName.pk}/name`, {
          name,
        }),
      "표기를 추가하지 못했습니다.",
    );
    if (added) {
      setAddingName(null);
      setAddNameNotice(null);
    }
  };

  const handleRemoveName = (company: Company, nameId: number, name: string) => {
    if (!window.confirm(`${company.name}에서 "${name}" 표기를 삭제할까요?`))
      return;
    void mutate(
      () => api.delete(`${BASE_PATH}/${company.company_id}/name/${nameId}`),
      "표기를 삭제하지 못했습니다.",
    );
  };

  const handleRemove = (company: Company) => {
    if (!window.confirm(`${company.name} 회사를 삭제할까요?`)) return;
    void mutate(
      () => api.delete(`${BASE_PATH}/${company.company_id}`),
      "회사를 삭제하지 못했습니다.",
    );
  };

  // 업로드 URL 발급 → S3에 직접 PUT → 회사에 연결
  const handleLogo = (company: Company, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void mutate(async () => {
      const upload = await api.post<UploadUrl>(`${BASE_PATH}/logo/upload-url`, {
        content_type: file.type,
        size: file.size,
      });
      const res = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      });
      if (!res.ok) {
        throw new Error(`로고를 올리지 못했습니다. (${res.status})`);
      }
      await api.put(`${BASE_PATH}/${company.company_id}/logo`, {
        key: upload.key,
      });
    }, "로고를 바꾸지 못했습니다.");
  };

  const handleMerge = async (target: Company) => {
    if (!mergeSource) return;
    const merged = await mutate(
      () =>
        api.post(`${BASE_PATH}/${mergeSource.company_id}/merge`, {
          target_id: target.company_id,
        }),
      "병합하지 못했습니다.",
    );
    if (merged) setMergeSource(null);
  };

  return (
    <>
      <div className="page-header">
        <h2>회사</h2>
      </div>

      <p className="placeholder">
        현업자는 표기(검색어) 중 하나로 회사를 찾습니다. 직접 입력해 새로 생긴
        회사는 검토 대기로 목록 맨 위에 올라오며, 같은 회사면 기존 회사로
        병합하고 아니면 승인합니다.
      </p>

      {error && <p className="error-text">{error}</p>}

      <form className="inline-form" onSubmit={handleCreate}>
        <input
          required
          maxLength={128}
          value={newCompany.name}
          placeholder="회사 이름 (예: Microsoft)"
          aria-label="새 회사 이름"
          onChange={(e) =>
            setNewCompany({ ...newCompany, name: e.target.value })
          }
        />
        <input
          value={newCompany.names}
          placeholder="다른 표기, 쉼표로 구분 (예: 마이크로소프트, 마소, MS)"
          aria-label="새 회사의 다른 표기"
          onChange={(e) =>
            setNewCompany({ ...newCompany, names: e.target.value })
          }
        />
        <button className="button small" type="submit" disabled={submitting}>
          회사 등록
        </button>
      </form>

      <CompanyImportPanel onImported={load} />

      <CompanySearchPreview />

      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>로고</th>
              <th>이름</th>
              <th>표기</th>
              <th>현업자</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((company) => (
              <tr key={company.company_id}>
                <td>
                  {company.logo_url ? (
                    <img
                      className="company-logo"
                      src={company.logo_url}
                      alt={`${company.name} 로고`}
                    />
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  {editing?.pk === company.company_id ? (
                    <form className="row-form" onSubmit={handleRename}>
                      <input
                        required
                        autoFocus
                        maxLength={128}
                        value={editing.name}
                        aria-label={`${company.name} 새 이름`}
                        onChange={(e) =>
                          setEditing({
                            pk: company.company_id,
                            name: e.target.value,
                          })
                        }
                      />
                      <button
                        className="button small"
                        type="submit"
                        disabled={submitting}
                      >
                        저장
                      </button>
                      <button
                        className="button secondary small"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        취소
                      </button>
                    </form>
                  ) : (
                    <>
                      {company.name}
                      {company.needs_review && (
                        <span className="tag">검토 대기</span>
                      )}
                    </>
                  )}
                </td>
                <td>
                  <div className="row-form">
                    {company.names.map((n) => (
                      <span key={n.name_id} className="tag">
                        {n.name}
                        <button
                          className="tag-remove"
                          disabled={submitting}
                          aria-label={`${n.name} 표기 삭제`}
                          onClick={() =>
                            handleRemoveName(company, n.name_id, n.name)
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {addingName?.pk === company.company_id ? (
                      <>
                        <form className="row-form" onSubmit={handleAddName}>
                          <input
                            required
                            autoFocus
                            maxLength={128}
                            value={addingName.name}
                            aria-label={`${company.name}에 추가할 표기`}
                            onChange={(e) => {
                              setAddNameNotice(null);
                              setAddingName({
                                pk: company.company_id,
                                name: e.target.value,
                              });
                            }}
                          />
                          <button
                            className="button small"
                            type="submit"
                            disabled={submitting}
                          >
                            추가
                          </button>
                          <button
                            className="button secondary small"
                            type="button"
                            onClick={() => {
                              setAddingName(null);
                              setAddNameNotice(null);
                            }}
                          >
                            취소
                          </button>
                        </form>
                        {addNameNotice && (
                          <p
                            className="error-text add-name-notice"
                            role="status"
                          >
                            {addNameNotice}
                          </p>
                        )}
                      </>
                    ) : (
                      <button
                        className="button secondary small"
                        disabled={submitting}
                        onClick={() => {
                          setAddNameNotice(null);
                          setAddingName({ pk: company.company_id, name: "" });
                        }}
                      >
                        + 표기
                      </button>
                    )}
                  </div>
                </td>
                <td>{company.graduated_count}</td>
                <td>
                  <div className="row-actions">
                    {company.needs_review && (
                      <button
                        className="button small"
                        disabled={submitting}
                        onClick={() => handleApprove(company)}
                      >
                        승인
                      </button>
                    )}
                    <button
                      className="button secondary small"
                      disabled={submitting}
                      onClick={() => setMergeSource(company)}
                    >
                      병합
                    </button>
                    <button
                      className="button secondary small"
                      disabled={submitting}
                      onClick={() =>
                        setEditing({
                          pk: company.company_id,
                          name: company.name,
                        })
                      }
                    >
                      이름 수정
                    </button>
                    <label className="button secondary small">
                      로고
                      <input
                        hidden
                        type="file"
                        accept={LOGO_TYPES}
                        disabled={submitting}
                        onChange={(e) => handleLogo(company, e)}
                      />
                    </label>
                    <button
                      className="button danger small"
                      disabled={submitting || company.graduated_count > 0}
                      title={
                        company.graduated_count > 0
                          ? "현업자가 고른 회사는 병합으로 정리합니다"
                          : undefined
                      }
                      onClick={() => handleRemove(company)}
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error && <p className="placeholder">불러오는 중...</p>}
        {data?.items.length === 0 && (
          <p className="placeholder">해당하는 회사가 없습니다.</p>
        )}
        {data && data.total > data.size && (
          <Pagination
            page={data.page}
            size={data.size}
            total={data.total}
            onChange={setPage}
          />
        )}
      </div>

      {mergeSource && (
        <MergeDialog
          source={mergeSource}
          submitting={submitting}
          onMerge={(target) => void handleMerge(target)}
          onClose={() => setMergeSource(null)}
        />
      )}
    </>
  );
}

// 현업자가 프로필 입력창에서 회사 이름을 칠 때 보게 될 결과를 그대로 보여 줌 (같은 검색 API)
function CompanySearchPreview() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const keyword = q.trim();
    // 빈 입력이면 검색하지 않음 (결과는 렌더링에서 숨김)
    if (!keyword) return;
    // 입력이 이어지면 이전 요청의 결과는 버림
    let stale = false;
    const timer = window.setTimeout(() => {
      api
        .get<SearchItem[]>(
          `${BASE_PATH}/search?${new URLSearchParams({ q: keyword })}`,
        )
        .then((items) => {
          if (stale) return;
          setResults(items);
          setError(null);
        })
        .catch((err: unknown) => {
          if (stale) return;
          setResults(null);
          setError(errorMessage(err, "회사를 검색하지 못했습니다."));
        });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="company-search">
      <input
        type="search"
        value={q}
        maxLength={128}
        placeholder="현업자처럼 회사 이름을 입력해 보세요 (예: 마소, micro)"
        aria-label="현업자 회사 검색 미리보기"
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim() && error && <p className="error-text">{error}</p>}
      {q.trim() && results && (
        <ul className="company-search-results">
          {results.map((item) => (
            <li key={item.company_id}>
              {item.logo_url ? (
                <img
                  className="company-logo"
                  src={item.logo_url}
                  alt={`${item.name} 로고`}
                />
              ) : (
                <span className="company-logo" />
              )}
              <span>{item.name}</span>
              {item.matched_name !== item.name && (
                <span className="placeholder">
                  &quot;{item.matched_name}&quot;(으)로 검색됨
                </span>
              )}
            </li>
          ))}
          {results.length === 0 && (
            <li className="placeholder">
              검색 결과가 없습니다. 현업자가 이대로 저장하면 &quot;{q.trim()}
              &quot;이(가) 새 회사로 등록되고 검토 대기로 들어옵니다.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type MergeDialogProps = {
  source: Company;
  submitting: boolean;
  onMerge: (target: Company) => void;
  onClose: () => void;
};

// 합쳐질 회사를 검색해서 고름. source의 표기 · 현업자가 target으로 옮겨지고 source는 삭제됨
function MergeDialog({
  source,
  submitting,
  onMerge,
  onClose,
}: MergeDialogProps) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Company[] | null>(null);
  const [target, setTarget] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const query = new URLSearchParams({ q: q.trim(), size: "10" });
      const page = await api.get<PageResponse<Company>>(
        `${BASE_PATH}?${query.toString()}`,
      );
      setCandidates(
        page.items.filter((c) => c.company_id !== source.company_id),
      );
    } catch (err) {
      setError(errorMessage(err, "회사를 검색하지 못했습니다."));
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-merge-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="company-merge-title">{source.name} 병합</h3>
        <p className="placeholder">
          {source.name}의 표기 {source.names.length}개와 현업자{" "}
          {source.graduated_count}명이 고른 회사로 옮겨지고, {source.name}은
          삭제됩니다.
        </p>
        <form className="inline-form" onSubmit={handleSearch}>
          <input
            required
            autoFocus
            value={q}
            placeholder="합칠 회사 검색"
            aria-label="합칠 회사 검색어"
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="button secondary small" type="submit">
            검색
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {candidates?.length === 0 && (
          <p className="placeholder">검색 결과가 없습니다.</p>
        )}
        {candidates?.map((c) => (
          <label key={c.company_id} className="row-form">
            <input
              type="radio"
              name="merge-target"
              checked={target?.company_id === c.company_id}
              onChange={() => setTarget(c)}
            />
            {c.name} ({c.names.map((n) => n.name).join(", ")})
          </label>
        ))}
        <div className="modal-actions">
          <button
            className="button secondary"
            disabled={submitting}
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="button danger"
            disabled={submitting || !target}
            onClick={() => target && onMerge(target)}
          >
            {submitting ? "병합 중..." : "병합"}
          </button>
        </div>
      </div>
    </div>
  );
}
