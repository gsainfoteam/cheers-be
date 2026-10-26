// 재학생의 학교는 인증한 이메일 도메인으로 정함 (school.email_domain)
export const emailDomain = (email: string): string =>
  email.slice(email.lastIndexOf("@") + 1);
