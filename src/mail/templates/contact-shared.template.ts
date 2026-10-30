import { SendMailInput } from "../mail.types";
import { escapeHtml } from "./escape-html";

// 재학생에게 가는 연락처 공유 알림 (알림톡 템플릿 contact_shared와 같은 문구).
// 연락처는 넣지 않고, 링크의 보낸 요청 상세에서 로그인 후 확인
export function buildContactSharedMail(
  to: string,
  recipientName: string,
  graduatedName: string,
  // 보낸 요청 상세 링크. WEB_BASE_URL이 없는 로컬에서는 null
  link: string | null,
): SendMailInput {
  const subject = "[Cheers] 커피챗 연락처가 공유됐어요";
  const text = [
    `${recipientName}님, ${graduatedName}님이 커피챗 연락처를 공유했어요.`,
    "아래 링크에서 연락처를 확인해 주세요.",
    ...(link ? ["", link] : []),
  ].join("\n");
  const button = link
    ? `\n  <p><a href="${escapeHtml(link)}" style="display: inline-block; padding: 10px 16px; background: #222; color: #fff; text-decoration: none; border-radius: 6px;">연락처 확인하기</a></p>`
    : "";
  const html = `<div style="font-family: sans-serif; line-height: 1.6;">
  <p>${escapeHtml(recipientName)}님, ${escapeHtml(graduatedName)}님이 커피챗 연락처를 공유했어요.<br />아래 버튼을 눌러 연락처를 확인해 주세요.</p>${button}
</div>`;

  return { to, subject, html, text };
}
