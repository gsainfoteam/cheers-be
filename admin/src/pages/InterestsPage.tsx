import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

const BASE_PATH = "/api/manager/v1/interest";

type Interest = {
  pk: number;
  name: string;
  sort_order: number;
};

export function InterestsPage() {
  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ pk: number; name: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.get<Interest[]>(BASE_PATH).then(setInterests),
    [],
  );

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "관심분야 목록을 불러오지 못했습니다.")),
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

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const added = await mutate(
      () => api.post(BASE_PATH, { name: name.trim() }),
      "관심분야를 추가하지 못했습니다.",
    );
    if (added) {
      setName("");
    }
  };

  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const renamed = await mutate(
      () =>
        api.patch(`${BASE_PATH}/${editing.pk}`, { name: editing.name.trim() }),
      "이름을 수정하지 못했습니다.",
    );
    if (renamed) {
      setEditing(null);
    }
  };

  const handleRemove = (interest: Interest) => {
    if (!window.confirm(`${interest.name} 항목을 삭제할까요?`)) return;
    void mutate(
      () => api.delete(`${BASE_PATH}/${interest.pk}`),
      "관심분야를 삭제하지 못했습니다.",
    );
  };

  const handleMove = (index: number, offset: -1 | 1) => {
    if (!interests) return;
    const pks = interests.map((interest) => interest.pk);
    [pks[index], pks[index + offset]] = [pks[index + offset], pks[index]];
    void mutate(
      () => api.put(`${BASE_PATH}/order`, { pks }),
      "순서를 바꾸지 못했습니다.",
    );
  };

  return (
    <>
      <div className="page-header">
        <h2>관심분야</h2>
      </div>

      <p className="placeholder">
        이름을 바꾸거나 삭제해도 학생이 이미 저장한 값은 바뀌지 않습니다. 변경한
        목록은 서버마다 최대 1분 안에 앱 화면에 반영됩니다.
      </p>

      {error && <p className="error-text">{error}</p>}

      <form className="inline-form" onSubmit={handleAdd}>
        <input
          required
          maxLength={50}
          value={name}
          placeholder="새 관심분야"
          aria-label="새 관심분야 이름"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="button small" type="submit" disabled={submitting}>
          추가
        </button>
      </form>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>순서</th>
              <th>이름</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {interests?.map((interest, index) => (
              <tr key={interest.pk}>
                <td>
                  <div className="row-actions">
                    <button
                      className="button secondary small"
                      disabled={submitting || index === 0}
                      aria-label={`${interest.name} 위로`}
                      onClick={() => handleMove(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="button secondary small"
                      disabled={submitting || index === interests.length - 1}
                      aria-label={`${interest.name} 아래로`}
                      onClick={() => handleMove(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </td>
                {editing?.pk === interest.pk ? (
                  <td colSpan={2}>
                    <form className="row-actions" onSubmit={handleRename}>
                      <input
                        required
                        autoFocus
                        maxLength={50}
                        value={editing.name}
                        aria-label={`${interest.name} 새 이름`}
                        onChange={(e) =>
                          setEditing({ pk: interest.pk, name: e.target.value })
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
                  </td>
                ) : (
                  <>
                    <td>{interest.name}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button secondary small"
                          disabled={submitting}
                          onClick={() =>
                            setEditing({ pk: interest.pk, name: interest.name })
                          }
                        >
                          수정
                        </button>
                        <button
                          className="button danger small"
                          disabled={submitting}
                          onClick={() => handleRemove(interest)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!interests && !error && <p className="placeholder">불러오는 중...</p>}
        {interests?.length === 0 && (
          <p className="placeholder">등록된 관심분야가 없습니다.</p>
        )}
      </div>
    </>
  );
}
