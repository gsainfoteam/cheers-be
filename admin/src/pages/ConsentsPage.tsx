import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useCurrentManager } from "../lib/current-manager";
import { errorMessage, formatDateTime } from "../lib/format";

const BASE_PATH = "/api/manager/v1/consent";

type ConsentVersion = {
  type: string;
  version: string;
  is_required: boolean;
  url: string;
  created_at: string;
  is_latest: boolean;
};

type ConsentType = {
  type: string;
  versions: ConsentVersion[];
};

type ConsentStatus = {
  agreed_count: number;
  revoked_count: number;
  withdrawn_count: number;
};

const statusKey = (version: ConsentVersion) =>
  `${version.type}/${version.version}`;

// 등록은 되돌릴 수 없으므로 사용자에게 영향이 있거나 실수로 보이는 경우 확인. null이면 확인 없이 등록
function confirmMessage(
  type: string,
  version: string,
  isRequired: boolean,
  latest: ConsentVersion | undefined,
): string | null {
  const warnings: string[] = [];
  if (isRequired) {
    warnings.push(
      "이 버전에 동의하지 않은 모든 사용자에게 재동의 요청(consent_required)이 켜집니다.",
    );
  } else if (latest?.is_required) {
    warnings.push(
      `${type}의 최신 버전은 필수 약관입니다. 등록하면 사용자에게 이 약관의 동의를 더 요구하지 않습니다.`,
    );
  }
  if (!latest) {
    warnings.push(
      `${type}은(는) 처음 등록하는 약관 종류입니다. 오타가 아닌지 확인해 주세요.`,
    );
  } else if (
    version.localeCompare(latest.version, undefined, { numeric: true }) < 0
  ) {
    // 최신 버전은 번호가 아니라 등록 시각으로 정해짐
    warnings.push(
      `현재 최신 버전 ${latest.version}보다 번호가 낮지만, 등록하면 이 버전이 최신이 됩니다.`,
    );
  }
  if (warnings.length === 0) return null;

  return [
    `${isRequired ? "필수" : "선택"} 약관 ${type} ${version}을(를) 등록할까요?`,
    ...warnings,
    "등록한 버전은 수정하거나 삭제할 수 없습니다.",
  ].join("\n");
}

export function ConsentsPage() {
  const me = useCurrentManager();
  const isSuperAdmin = me.role === "superadmin";

  const [consentTypes, setConsentTypes] = useState<ConsentType[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ConsentStatus>>({});
  const [type, setType] = useState("");
  const [version, setVersion] = useState("");
  const [url, setUrl] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.get<ConsentType[]>(BASE_PATH).then(setConsentTypes),
    [],
  );

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(errorMessage(err, "약관 목록을 불러오지 못했습니다.")),
    );
  }, [load]);

  const latestOf = (name: string) =>
    consentTypes
      ?.find((consentType) => consentType.type === name)
      ?.versions.find((v) => v.is_latest);

  // 개정할 때 필수 여부를 실수로 바꾸지 않도록 최신 버전의 값으로 채움.
  // 채운 값이 다른 종류로 넘어가지 않게, 기존 종류에서 벗어나면 되돌림
  const handleTypeChange = (next: string) => {
    const latest = latestOf(next.trim());
    if (latest) setIsRequired(latest.is_required);
    else if (latestOf(type.trim())) setIsRequired(false);
    setType(next);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const nextType = type.trim();
    const nextVersion = version.trim();

    const message = confirmMessage(
      nextType,
      nextVersion,
      isRequired,
      latestOf(nextType),
    );
    if (message && !window.confirm(message)) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.post(BASE_PATH, {
        type: nextType,
        version: nextVersion,
        is_required: isRequired,
        url: url.trim(),
      });
    } catch (err) {
      setError(errorMessage(err, "약관을 등록하지 못했습니다."));
      setSubmitting(false);
      return;
    }

    setVersion("");
    setUrl("");
    try {
      await load();
    } catch {
      // 오래된 목록으로 확인 창을 판단하지 않도록 비워서 등록을 막음
      setConsentTypes(null);
      setError(
        "약관은 등록했지만 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadStatus = async (target: ConsentVersion) => {
    setError(null);
    try {
      const status = await api.get<ConsentStatus>(
        `${BASE_PATH}/${encodeURIComponent(target.type)}/${encodeURIComponent(target.version)}/status`,
      );
      setStatuses((prev) => ({ ...prev, [statusKey(target)]: status }));
    } catch (err) {
      setError(errorMessage(err, "동의 현황을 불러오지 못했습니다."));
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>이용약관</h2>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isSuperAdmin ? (
        <form className="inline-form" onSubmit={handleAdd}>
          <input
            required
            list="consent-types"
            value={type}
            placeholder="종류 (예: tos)"
            aria-label="약관 종류"
            onChange={(e) => handleTypeChange(e.target.value)}
          />
          <datalist id="consent-types">
            {consentTypes?.map((consentType) => (
              <option key={consentType.type} value={consentType.type} />
            ))}
          </datalist>
          <input
            required
            value={version}
            placeholder="버전 (예: 261031)"
            aria-label="약관 버전"
            onChange={(e) => setVersion(e.target.value)}
          />
          <input
            type="url"
            required
            value={url}
            placeholder="본문 링크 (https://...)"
            aria-label="본문 링크"
            onChange={(e) => setUrl(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />{" "}
            필수
          </label>
          <button
            className="button small"
            type="submit"
            disabled={submitting || !consentTypes}
          >
            새 버전 등록
          </button>
        </form>
      ) : (
        <p className="placeholder">
          새 버전 등록은 superadmin만 할 수 있습니다.
        </p>
      )}

      {consentTypes?.map((consentType) => (
        <div className="card" key={consentType.type}>
          <h3>{consentType.type}</h3>
          <table>
            <thead>
              <tr>
                <th>버전</th>
                <th>필수</th>
                <th>본문</th>
                <th>등록일</th>
                <th>동의 · 철회 현황</th>
              </tr>
            </thead>
            <tbody>
              {consentType.versions.map((item) => {
                const status = statuses[statusKey(item)];
                return (
                  <tr key={item.version}>
                    <td>
                      {item.version}
                      {item.is_latest && " (최신)"}
                    </td>
                    <td>{item.is_required ? "필수" : "선택"}</td>
                    <td>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        링크
                      </a>
                    </td>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>
                      {status && (
                        <>
                          동의 {status.agreed_count} · 철회{" "}
                          {status.revoked_count} · 탈퇴{" "}
                          {status.withdrawn_count}{" "}
                        </>
                      )}
                      <button
                        className="button secondary small"
                        onClick={() => void handleLoadStatus(item)}
                      >
                        {status ? "새로고침" : "조회"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {!consentTypes && !error && <p className="placeholder">불러오는 중...</p>}
      {consentTypes?.length === 0 && (
        <p className="placeholder">등록된 약관이 없습니다.</p>
      )}
    </>
  );
}
