import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { AdminRole, useCurrentManager } from "../lib/current-manager";

const BASE_PATH = "/api/manager/v1/admin-account";
const ROLES: AdminRole[] = ["admin", "superadmin"];

type AdminAccount = {
  pk: string;
  email: string;
  role: AdminRole;
  created_at: string;
  updated_at: string;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function AdminAccountsPage() {
  const me = useCurrentManager();
  const isSuperAdmin = me.role === "superadmin";

  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("admin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.get<AdminAccount[]>(BASE_PATH).then(setAccounts),
    [],
  );

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "어드민 목록을 불러오지 못했습니다.")),
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
      () => api.post(BASE_PATH, { email: email.trim(), role }),
      "어드민을 등록하지 못했습니다.",
    );
    if (added) {
      setEmail("");
      setRole("admin");
    }
  };

  const handleRemove = (account: AdminAccount) => {
    if (!window.confirm(`${account.email} 계정을 삭제할까요?`)) return;
    void mutate(
      () => api.delete(`${BASE_PATH}/${account.pk}`),
      "어드민을 삭제하지 못했습니다.",
    );
  };

  const handleRoleChange = (account: AdminAccount, next: AdminRole) => {
    void mutate(
      () => api.patch(`${BASE_PATH}/${account.pk}`, { role: next }),
      "권한을 변경하지 못했습니다.",
    );
  };

  return (
    <>
      <div className="page-header">
        <h2>어드민 계정</h2>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isSuperAdmin ? (
        <form className="inline-form" onSubmit={handleAdd}>
          <input
            type="email"
            required
            value={email}
            placeholder="name@gm.gist.ac.kr"
            aria-label="이메일"
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            value={role}
            aria-label="권한"
            onChange={(e) => setRole(e.target.value as AdminRole)}
          >
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button className="button small" type="submit" disabled={submitting}>
            등록
          </button>
        </form>
      ) : (
        <p className="placeholder">
          등록 · 변경 · 삭제는 superadmin만 할 수 있습니다.
        </p>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>이메일</th>
              <th>권한</th>
              <th>등록일</th>
              {isSuperAdmin && <th aria-label="삭제" />}
            </tr>
          </thead>
          <tbody>
            {accounts?.map((account) => {
              const isSelf = account.email === me.email;
              return (
                <tr key={account.pk}>
                  <td>
                    {account.email}
                    {isSelf && " (나)"}
                  </td>
                  <td>
                    {isSuperAdmin && !isSelf ? (
                      <select
                        value={account.role}
                        disabled={submitting}
                        aria-label={`${account.email} 권한`}
                        onChange={(e) =>
                          handleRoleChange(account, e.target.value as AdminRole)
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      account.role
                    )}
                  </td>
                  <td>{formatDateTime(account.created_at)}</td>
                  {isSuperAdmin && (
                    <td>
                      {!isSelf && account.role !== "superadmin" && (
                        <button
                          className="button danger small"
                          disabled={submitting}
                          onClick={() => handleRemove(account)}
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!accounts && !error && <p className="placeholder">불러오는 중...</p>}
      </div>
    </>
  );
}
