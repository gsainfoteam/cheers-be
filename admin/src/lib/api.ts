import { clearAccessToken, getAccessToken, loginPagePath } from "./auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// 서버 에러 응답은 { statusCode, message }. 그 외 형식이면 상태 코드만 보여 줌
async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  const message = Array.isArray(body?.message)
    ? body.message.join(", ")
    : typeof body?.message === "string"
      ? body.message
      : `요청에 실패했습니다. (${res.status})`;
  return new ApiError(res.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  // 토큰 만료 · 계정 삭제. 로그인 요청의 401은 호출한 화면에서 안내
  if (res.status === 401 && token) {
    clearAccessToken();
    window.location.href = loginPagePath();
    throw new ApiError(401, "다시 로그인해 주세요.");
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
