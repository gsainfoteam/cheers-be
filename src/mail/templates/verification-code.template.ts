import { SendMailInput } from "../mail.types";

export function buildVerificationCodeMail(
  to: string,
  code: string,
  ttlMinutes: number,
): SendMailInput {
  const subject = "[Cheers] 학교 이메일 인증번호";
  const text = [
    "Cheers 학교 이메일 인증번호입니다.",
    "",
    `인증번호: ${code}`,
    "",
    `인증번호는 ${ttlMinutes}분 동안 유효합니다.`,
    "본인이 요청하지 않았다면 이 메일을 무시해 주세요.",
  ].join("\n");
  const html = `<div style="font-family: sans-serif; line-height: 1.6;">
  <p>Cheers 학교 이메일 인증번호입니다.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>
  <p>인증번호는 ${ttlMinutes}분 동안 유효합니다.<br />본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>
</div>`;

  return { to, subject, html, text };
}
