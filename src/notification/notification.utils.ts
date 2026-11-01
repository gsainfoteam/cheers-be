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
