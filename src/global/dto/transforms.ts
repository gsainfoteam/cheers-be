// class-transformer @Transform용. 문자열이 아니면 그대로 둬서 검증 데코레이터가 거르게 함
export const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
