export const MANAGER_EMAIL_DOMAIN = "@gm.gist.ac.kr";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
