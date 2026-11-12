import { SendMailInput } from "../mail.types";
import { renderButton, renderMailLayout } from "./layout";

// 현업자에게 가는 커피챗 요청 알림. 텍스트 본문은 알림톡 템플릿 coffee_chat_requested와 같은 문구.
// 재학생 정보는 넣지 않고, 링크의 요청 상세에서 로그인 후 확인
export function buildCoffeeChatRequestedMail(
  to: string,
  recipientName: string,
  // 요청 상세 링크. WEB_BASE_URL이 없는 로컬에서는 null
  link: string | null,
  // 하단 사이트 링크 (WEB_BASE_URL)
  siteUrl: string | null = null,
): SendMailInput {
  const subject = "[Cheers] 새 커피챗 요청이 도착했어요";
  const text = [
    `${recipientName}님, 취얼스에서 새 커피챗 요청이 도착했어요.`,
    "아래 링크에서 요청 내용을 확인해 주세요.",
    ...(link ? ["", link] : []),
  ].join("\n");
  const html = renderMailLayout({
    title: "새로운 커피챗 요청이 도착했어요",
    descriptionLines: [
      "요청자로부터 온 메시지를 확인하고",
      "커피챗 가능 여부를 알려주세요",
    ],
    contentHtml: renderButton("커피챗 요청 확인하기", link),
    siteUrl,
  });

  return { to, subject, html, text };
}
