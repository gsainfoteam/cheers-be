import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { dayStart, errorMessage, PageResponse } from "./coffee-chat";

function toApiQuery(params: URLSearchParams, filterKeys: readonly string[]) {
  const query = new URLSearchParams({ page: params.get("page") ?? "1" });
  for (const key of filterKeys) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from) query.set("created_from", dayStart(from));
  if (to) query.set("created_to", dayStart(to, 1));
  return query.toString();
}

// 필터와 페이지를 URL에 두어 상세 화면에서 돌아와도 유지됨.
// 검색 폼은 name이 필터 키인 입력을 쓰고 key={formKey}로 URL이 바뀔 때 입력값을 다시 읽음
export function usePagedList<T>(
  basePath: string,
  filterKeys: readonly string[],
  fallbackError: string,
) {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<PageResponse<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiQuery = toApiQuery(params, filterKeys);
  useEffect(() => {
    let stale = false;
    api
      .get<PageResponse<T>>(`${basePath}?${apiQuery}`)
      .then((page) => {
        if (stale) return;
        setResult(page);
        setError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setResult(null);
        setError(errorMessage(err, fallbackError));
      });
    return () => {
      stale = true;
    };
  }, [basePath, apiQuery, fallbackError]);

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(e.currentTarget)) {
      const trimmed = String(value).trim();
      if (trimmed) next.set(key, trimmed);
    }
    setParams(next);
  };

  const goToPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };

  const filters = new URLSearchParams(params);
  filters.delete("page");

  return {
    params,
    result,
    error,
    search,
    goToPage,
    formKey: filters.toString(),
  };
}
