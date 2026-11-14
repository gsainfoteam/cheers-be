// class-transformer @Transform용. 문자열이 아니면 그대로 둬서 검증 데코레이터가 거르게 함
export const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** 앞뒤 공백 제거 후 빈 문자열이면 undefined (선택 항목을 비워 보낸 경우) */
export const trimToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};
