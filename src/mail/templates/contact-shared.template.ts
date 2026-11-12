import { SendMailInput } from "../mail.types";
import { renderButton, renderMailLayout } from "./layout";

// 재학생에게 가는 연락처 공유 알림. 텍스트 본문은 알림톡 템플릿 contact_shared와 같은 문구.
// 연락처는 넣지 않고, 링크의 보낸 요청 상세에서 로그인 후 확인
export function buildContactSharedMail(
  to: string,
  recipientName: string,
  graduatedName: string,
  // 보낸 요청 상세 링크. WEB_BASE_URL이 없는 로컬에서는 null
  link: string | null,
  // 하단 사이트 링크 (WEB_BASE_URL)
  siteUrl: string | null = null,
): SendMailInput {
  const subject = "[Cheers] 커피챗 연락처가 공유됐어요";
  const text = [
    `${recipientName}님, ${graduatedName}님이 커피챗 연락처를 공유했어요.`,
    "아래 링크에서 연락처를 확인해 주세요.",
    ...(link ? ["", link] : []),
  ].join("\n");
  const html = renderMailLayout({
    title: "선배가 연락처를 공유했어요",
    descriptionLines: ["선배의 연락처를 확인하고", "커피챗 일정을 잡아볼까요?"],
    contentHtml: renderButton("연락처 확인하기", link),
    siteUrl,
  });

  return { to, subject, html, text };
}
