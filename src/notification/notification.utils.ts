/**
 * masks a recipient for logs and Slack, e.g. 010****5678, gi***@gm.gist.ac.kr
 */
export function maskRecipient(recipient: string): string {
  const at = recipient.indexOf("@");
  if (at >= 0) {
    return `${recipient.slice(0, Math.min(2, at))}***${recipient.slice(at)}`;
  }
  if (recipient.length <= 4) return "****";
  return `${recipient.slice(0, 3)}****${recipient.slice(-4)}`;
}

const EMAIL_PATTERN = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g;
// 010-1234-5678, 01012345678, +82 10 1234 5678
const PHONE_PATTERN =
  /(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

/**
 * masks the recipient and any email or phone number in a provider error message.
 * provider messages are free text, so the recipient can appear in another format
 */
export function maskPersonalInfo(text: string, recipient: string): string {
  const withoutRecipient = recipient
    ? text.replaceAll(recipient, () => maskRecipient(recipient))
    : text;
  return withoutRecipient
    .replace(EMAIL_PATTERN, (email) => maskRecipient(email))
    .replace(PHONE_PATTERN, (phone) => maskRecipient(phone.replace(/\D/g, "")));
}

/**
 * 알리고 잔여량 중 부족 여부를 비교할 값. 알림톡 건수(키가 alt로 시작)가 있으면 그것, 없으면 잔여 충전금액 (CRB-78).
 * 실제 응답 필드명을 확인하면 이 규칙을 맞춰야 함
 */
export function pickRemaining(balance: {
  amount: number | null;
  counts: Record<string, number>;
}): { label: string; value: number } | null {
  const altKey = Object.keys(balance.counts).find((key) =>
    key.startsWith("alt"),
  );
  if (altKey !== undefined) {
    return { label: altKey, value: balance.counts[altKey] };
  }
  return balance.amount === null
    ? null
    : { label: "amount", value: balance.amount };
}
