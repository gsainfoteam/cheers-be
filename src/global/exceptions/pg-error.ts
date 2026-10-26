// PostgreSQL 에러 코드 판별. drizzle은 드라이버 에러를 DrizzleQueryError.cause에 담아 던짐
const UNIQUE_VIOLATION = "23505";

const pgErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return pgErrorCode(error.cause);
  return undefined;
};

export const isUniqueViolation = (error: unknown): boolean =>
  pgErrorCode(error) === UNIQUE_VIOLATION;
