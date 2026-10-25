export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  // 자격증명이 없어 실제로 발송하지 않음 (로컬)
  skipped?: boolean;
}
