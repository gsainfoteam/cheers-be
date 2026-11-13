import { escapeHtml } from "./escape-html";
import { CHEERS_LOGO_CID } from "./logo";

// 세 메일(재학생 인증 · 커피챗 요청 · 연락처 공유)이 같이 쓰는 틀 (CRB-70 디자인).
// 메일 클라이언트 호환을 위해 table 레이아웃 + 인라인 스타일만 씀
const COLOR = {
  background: "#FFF8F0",
  card: "#FFFFFF",
  border: "#EFE9E1",
  title: "#111111",
  body: "#333333",
  muted: "#8C8C8C",
  codeBackground: "#F5EFE6",
  button: "#FF8A3D",
};

// 하단 "cheers 문의하기" 링크. 사이트 주소와 상관없이 항상 문의 메일로 연결
const INQUIRY_MAILTO = "mailto:cheers@gistory.me";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
const MONO_FONT = "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace";

export type MailLayoutInput = {
  title: string;
  // 제목 아래 설명. 줄마다 <br />로 이음
  descriptionLines: string[];
  // 설명 아래 본문 (인증번호 상자 또는 버튼). 이미 이스케이프된 html
  contentHtml: string;
  // 하단의 사이트 주소 링크 (WEB_BASE_URL). 없으면 링크 없이 문구만
  siteUrl: string | null;
};

export function renderMailLayout(input: MailLayoutInput): string {
  const description = input.descriptionLines.map(escapeHtml).join("<br />");
  const siteUrl = input.siteUrl ? escapeHtml(input.siteUrl) : null;
  const siteLine = siteUrl
    ? `<br /><a href="${siteUrl}" style="color: ${COLOR.muted}; text-decoration: none;">${siteUrl}</a>`
    : "";
  const inquiry = `<a href="${INQUIRY_MAILTO}" style="color: ${COLOR.muted}; text-decoration: underline;">cheers 문의하기</a>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLOR.background};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLOR.background}; font-family: ${FONT};">
  <tr>
    <td align="center" style="padding: 24px 16px 48px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 400px; background-color: ${COLOR.card}; border: 1px solid ${COLOR.border}; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);">
        <tr>
          <td style="padding: 16px 20px; border-bottom: 1px solid ${COLOR.border};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 8px;"><img src="cid:${CHEERS_LOGO_CID}" width="36" height="28" alt="" style="display: block; border: 0;" /></td>
                <td style="vertical-align: middle; font-size: 20px; font-weight: 700; color: ${COLOR.title};">취얼스</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 40px 24px 0;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; line-height: 1.4; color: ${COLOR.title};">${escapeHtml(input.title)}</h1>
            <p style="margin: 12px 0 0; font-size: 15px; line-height: 1.6; color: ${COLOR.body};">${description}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 40px 24px 0;">${input.contentHtml}</td>
        </tr>
        <tr>
          <td align="center" style="padding: 48px 24px 24px; font-family: ${MONO_FONT}; font-size: 11px; line-height: 1.6; letter-spacing: 1px; color: ${COLOR.muted};">선배와 후배의 커리어가 이어지는 곳, 취얼스${siteLine}</td>
        </tr>
      </table>
      <p style="margin: 20px 0 0; max-width: 400px; font-size: 13px; line-height: 1.6; color: ${COLOR.muted};">본 메일은 안내 목적으로 발송되는 발신 전용 메일입니다.<br />문의사항이나 이용안내는 ${inquiry}를 이용해주세요.</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// 인증번호 상자
export function renderCodeBox(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 300px;">
  <tr>
    <td align="center" style="padding: 16px 12px; background-color: ${COLOR.codeBackground}; border-radius: 8px; font-family: ${MONO_FONT}; font-size: 30px; font-weight: 700; letter-spacing: 6px; color: ${COLOR.title};">${escapeHtml(code)}</td>
  </tr>
</table>`;
}

// 주황색 버튼. 링크가 없으면(WEB_BASE_URL이 없는 로컬) 버튼을 뺌
export function renderButton(label: string, link: string | null): string {
  if (!link) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 300px;">
  <tr>
    <td align="center" style="background-color: ${COLOR.button}; border-radius: 8px;"><a href="${escapeHtml(link)}" target="_blank" style="display: block; padding: 16px 12px; font-size: 16px; font-weight: 700; color: #FFFFFF; text-decoration: none;">${escapeHtml(label)}</a></td>
  </tr>
</table>`;
}
