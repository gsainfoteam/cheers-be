import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useCurrentManager } from "../lib/current-manager";

const BASE_PATH = "/api/manager/v1/school";

type School = {
  pk: number;
  name: string;
  email_domains: string[];
};

type Department = {
  pk: number;
  school_pk: number;
  name: string;
  is_active: boolean;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function DepartmentsPage() {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [schoolPk, setSchoolPk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<School[]>(BASE_PATH)
      .then((list) => {
        setSchools(list);
        setSchoolPk(list[0]?.pk ?? null);
      })
      .catch((err: unknown) =>
        setError(errorMessage(err, "학교 목록을 불러오지 못했습니다.")),
      );
  }, []);

  const school = schools?.find((s) => s.pk === schoolPk);

  return (
    <>
      <div className="page-header">
        <h2>학과</h2>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!schools && !error && <p className="placeholder">불러오는 중...</p>}

      {schools && (
        <div className="inline-form">
          <select
            value={schoolPk ?? ""}
            aria-label="학교"
            onChange={(e) => setSchoolPk(Number(e.target.value))}
          >
            {schools.map((s) => (
              <option key={s.pk} value={s.pk}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 학교를 바꾸면 key가 바뀌어 편집 중이던 값이 모두 초기화됨 */}
      {school && (
        <SchoolSection
          key={school.pk}
          school={school}
          onSchoolSaved={(saved) =>
            setSchools(
              (list) =>
                list?.map((s) => (s.pk === saved.pk ? saved : s)) ?? null,
            )
          }
        />
      )}
    </>
  );
}

function SchoolSection({
  school,
  onSchoolSaved,
}: {
  school: School;
  onSchoolSaved: (school: School) => void;
}) {
  const me = useCurrentManager();
  const isSuperAdmin = me.role === "superadmin";

  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ pk: number; name: string } | null>(
    null,
  );
  const [domains, setDomains] = useState(school.email_domains);
  const [newDomain, setNewDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departmentsPath = `${BASE_PATH}/${school.pk}/department`;

  const load = useCallback(
    () => api.get<Department[]>(departmentsPath).then(setDepartments),
    [departmentsPath],
  );

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "학과 목록을 불러오지 못했습니다.")),
    );
  }, [load]);

  // 변경 후 목록을 다시 읽음. 실패하면 서버 메시지를 그대로 보여 줌
  const mutate = async (action: () => Promise<unknown>, fallback: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const added = await mutate(
      () => api.post(departmentsPath, { name: newName.trim() }),
      "학과를 추가하지 못했습니다.",
    );
    if (added) setNewName("");
  };

  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const renamed = await mutate(
      () =>
        api.patch(`${departmentsPath}/${editing.pk}`, {
          name: editing.name.trim(),
        }),
      "이름을 수정하지 못했습니다.",
    );
    if (renamed) setEditing(null);
  };

  const handleToggleActive = (department: Department) => {
    const next = !department.is_active;
    if (
      !next &&
      !window.confirm(
        `${department.name}을(를) 비활성화할까요? 앱의 학과 목록에서 숨겨지고 새로 고를 수 없습니다. 이미 고른 학생의 정보는 그대로입니다.`,
      )
    ) {
      return;
    }
    void mutate(
      () =>
        api.patch(`${departmentsPath}/${department.pk}`, { is_active: next }),
      "학과 상태를 변경하지 못했습니다.",
    );
  };

  const handleAddDomain = (e: FormEvent) => {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase();
    if (domain && !domains.includes(domain)) {
      setDomains([...domains, domain]);
    }
    setNewDomain("");
  };

  const handleSaveDomains = () => {
    if (
      !window.confirm(
        "허용 이메일 도메인을 저장할까요? 재학생 인증 범위가 바로 바뀝니다.",
      )
    ) {
      return;
    }
    void mutate(async () => {
      const saved = await api.put<School>(
        `${BASE_PATH}/${school.pk}/email-domain`,
        { email_domains: domains },
      );
      setDomains(saved.email_domains);
      onSchoolSaved(saved);
    }, "허용 도메인을 저장하지 못했습니다.");
  };

  const domainsChanged =
    domains.length !== school.email_domains.length ||
    domains.some((d, i) => d !== school.email_domains[i]);

  return (
    <>
      {error && <p className="error-text">{error}</p>}

      <h3>허용 이메일 도메인</h3>
      {!isSuperAdmin && (
        <p className="placeholder">
          허용 도메인 변경은 superadmin만 할 수 있습니다.
        </p>
      )}
      <div className="card">
        <table>
          <tbody>
            {domains.map((domain) => (
              <tr key={domain}>
                <td>{domain}</td>
                {isSuperAdmin && (
                  <td>
                    <button
                      className="button danger small"
                      disabled={submitting || domains.length === 1}
                      onClick={() =>
                        setDomains(domains.filter((d) => d !== domain))
                      }
                    >
                      빼기
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isSuperAdmin && (
        <form className="inline-form" onSubmit={handleAddDomain}>
          <input
            value={newDomain}
            placeholder="gm.gist.ac.kr"
            aria-label="추가할 도메인"
            maxLength={128}
            onChange={(e) => setNewDomain(e.target.value)}
          />
          <button
            className="button secondary small"
            type="submit"
            disabled={submitting || !newDomain.trim()}
          >
            목록에 추가
          </button>
          <button
            className="button small"
            type="button"
            disabled={submitting || !domainsChanged}
            onClick={handleSaveDomains}
          >
            저장
          </button>
        </form>
      )}

      <h3>학과 목록</h3>
      <form className="inline-form" onSubmit={handleAdd}>
        <input
          required
          value={newName}
          placeholder="학과 이름"
          aria-label="추가할 학과 이름"
          maxLength={64}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          className="button small"
          type="submit"
          disabled={submitting || !newName.trim()}
        >
          추가
        </button>
      </form>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>상태</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {departments?.map((department) => (
              <tr key={department.pk}>
                <td>
                  {editing?.pk === department.pk ? (
                    <form className="row-form" onSubmit={handleRename}>
                      <input
                        required
                        value={editing.name}
                        aria-label={`${department.name} 새 이름`}
                        maxLength={64}
                        onChange={(e) =>
                          setEditing({
                            pk: department.pk,
                            name: e.target.value,
                          })
                        }
                      />
                      <button
                        className="button small"
                        type="submit"
                        disabled={submitting || !editing.name.trim()}
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
                    department.name
                  )}
                </td>
                <td>{department.is_active ? "활성" : "비활성"}</td>
                <td className="row-actions">
                  <button
                    className="button secondary small"
                    disabled={submitting}
                    onClick={() =>
                      setEditing({
                        pk: department.pk,
                        name: department.name,
                      })
                    }
                  >
                    이름 수정
                  </button>
                  <button
                    className={`button small ${department.is_active ? "danger" : "secondary"}`}
                    disabled={submitting}
                    onClick={() => handleToggleActive(department)}
                  >
                    {department.is_active ? "비활성화" : "재활성화"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!departments && !error && (
          <p className="placeholder">불러오는 중...</p>
        )}
      </div>
    </>
  );
}
