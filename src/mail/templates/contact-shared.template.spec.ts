import { buildContactSharedMail } from "./contact-shared.template";

describe("buildContactSharedMail", () => {
  const link = "https://cheers.example.com/cheers/sent/1";

  it("names both people in the text and links to the sent request", () => {
    const mail = buildContactSharedMail("a@b.c", "홍길동", "김철수", link);

    expect(mail.to).toBe("a@b.c");
    expect(mail.text).toContain("홍길동님, 김철수님이");
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("선배가 연락처를 공유했어요");
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.html).toContain("연락처 확인하기");
  });

  it("leaves out the button when there is no link", () => {
    const mail = buildContactSharedMail("a@b.c", "홍길동", "김철수", null);

    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a ");
    expect(mail.html).not.toContain("연락처 확인하기");
  });

  it("does not put names into the html", () => {
    const mail = buildContactSharedMail("a@b.c", "<b>", '"x"&', null);

    expect(mail.html).not.toContain("<b>");
    expect(mail.html).not.toContain('"x"&');
  });
});
