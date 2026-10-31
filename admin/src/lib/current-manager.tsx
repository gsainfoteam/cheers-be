import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, ApiError } from "./api";

export type AdminRole = "admin" | "superadmin";
export type CurrentManager = { email: string; role: AdminRole };

const CurrentManagerContext = createContext<CurrentManager | null>(null);

// 레이아웃에 들어올 때 한 번 조회해서 하위 화면과 공유
export function CurrentManagerProvider({ children }: { children: ReactNode }) {
  const [manager, setManager] = useState<CurrentManager | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<CurrentManager>("/api/manager/v1/auth/me")
      .then(setManager)
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "계정 정보를 불러오지 못했습니다.",
        ),
      );
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setError(null);
    load();
  };

  if (error) {
    return (
      <>
        <p className="error-text">{error}</p>
        <button className="button secondary" onClick={retry}>
          다시 시도
        </button>
      </>
    );
  }
  if (!manager) return <p className="placeholder">불러오는 중...</p>;

  return (
    <CurrentManagerContext.Provider value={manager}>
      {children}
    </CurrentManagerContext.Provider>
  );
}

export function useCurrentManager(): CurrentManager {
  const manager = useContext(CurrentManagerContext);
  if (!manager) {
    throw new Error(
      "useCurrentManager must be used inside CurrentManagerProvider",
    );
  }
  return manager;
}
