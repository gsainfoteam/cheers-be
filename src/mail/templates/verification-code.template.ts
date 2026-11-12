import { SendMailInput } from "../mail.types";
import { renderCodeBox, renderMailLayout } from "./layout";

export function buildVerificationCodeMail(
  to: string,
  code: string,
  ttlMinutes: number,
  // 하단 사이트 링크 (WEB_BASE_URL). 없으면 링크 없이 발송
  siteUrl: string | null = null,
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
  const html = renderMailLayout({
    title: "가입 인증 번호",
    descriptionLines: [
      "아래 인증번호를 입력하여",
      "이메일 인증을 완료해주세요.",
    ],
    contentHtml: renderCodeBox(code),
    siteUrl,
  });

  return { to, subject, html, text };
}
