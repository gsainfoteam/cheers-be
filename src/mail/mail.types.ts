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
}
