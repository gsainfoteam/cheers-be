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
