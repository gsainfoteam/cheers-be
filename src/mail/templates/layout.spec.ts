import { buildVerificationCodeMail } from "./verification-code.template";
import { renderButton, renderMailLayout } from "./layout";
import { CHEERS_LOGO_CID } from "./logo";

describe("mail layout", () => {
  it("renders the logo, title, description and footer", () => {
    const html = renderMailLayout({
      title: "제목",
      descriptionLines: ["첫 줄", "<둘째 줄>"],
      contentHtml: "<p>본문</p>",
      siteUrl: "https://cheers.example.com",
    });

    expect(html).toContain(`src="cid:${CHEERS_LOGO_CID}"`);
    expect(html).toContain("제목");
    expect(html).toContain("첫 줄<br />&lt;둘째 줄&gt;");
    expect(html).toContain("<p>본문</p>");
    expect(html).toContain('href="https://cheers.example.com"');
    expect(html).toContain("발신 전용 메일");
  });

  it("drops the footer links without a site url", () => {
    const html = renderMailLayout({
      title: "제목",
      descriptionLines: [],
      contentHtml: "",
      siteUrl: null,
    });

    expect(html).not.toContain("<a ");
    expect(html).toContain("cheers 문의하기");
  });

  it("escapes the button link and renders nothing without one", () => {
    expect(renderButton("확인", 'https://x.com/?a=1&b="2"')).toContain(
      'href="https://x.com/?a=1&amp;b=&quot;2&quot;"',
    );
    expect(renderButton("확인", null)).toBe("");
  });
});

describe("buildVerificationCodeMail", () => {
  it("shows the code in the box and keeps the ttl in the text", () => {
    const mail = buildVerificationCodeMail("a@b.c", "123465", 5);

    expect(mail.html).toContain("가입 인증 번호");
    expect(mail.html).toContain(">123465</td>");
    expect(mail.text).toContain("인증번호: 123465");
    expect(mail.text).toContain("5분");
  });
});
