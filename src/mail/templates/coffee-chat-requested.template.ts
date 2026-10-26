import { SendMailInput } from "../mail.types";

// 현업자에게 가는 커피챗 요청 알림 (알림톡 템플릿 coffee_chat_requested와 같은 문구).
// 재학생 정보는 넣지 않고, 링크의 요청 상세에서 로그인 후 확인
export function buildCoffeeChatRequestedMail(
  to: string,
  recipientName: string,
  // 요청 상세 링크. WEB_BASE_URL이 없는 로컬에서는 null
  link: string | null,
): SendMailInput {
  const subject = "[Cheers] 새 커피챗 요청이 도착했어요";
  const text = [
    `${recipientName}님, 취얼스에서 새 커피챗 요청이 도착했어요.`,
    "아래 링크에서 요청 내용을 확인해 주세요.",
    ...(link ? ["", link] : []),
  ].join("\n");
  const button = link
    ? `\n  <p><a href="${escapeHtml(link)}" style="display: inline-block; padding: 10px 16px; background: #222; color: #fff; text-decoration: none; border-radius: 6px;">요청 확인하기</a></p>`
    : "";
  const html = `<div style="font-family: sans-serif; line-height: 1.6;">
  <p>${escapeHtml(recipientName)}님, 취얼스에서 새 커피챗 요청이 도착했어요.<br />아래 버튼을 눌러 요청 내용을 확인해 주세요.</p>${button}
</div>`;

  return { to, subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
