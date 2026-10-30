import { buildContactSharedMail } from "./contact-shared.template";

describe("buildContactSharedMail", () => {
  const link = "https://cheers.example.com/cheers/sent/1";

  it("names both people and links to the sent request", () => {
    const mail = buildContactSharedMail("a@b.c", "홍길동", "김철수", link);

    expect(mail.to).toBe("a@b.c");
    expect(mail.text).toContain("홍길동님, 김철수님이");
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
  });

  it("leaves out the link when there is none", () => {
    const mail = buildContactSharedMail("a@b.c", "홍길동", "김철수", null);

    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a ");
  });

  it("escapes names in the html", () => {
    const mail = buildContactSharedMail("a@b.c", "<b>", '"x"&', null);

    expect(mail.html).toContain("&lt;b&gt;님");
    expect(mail.html).toContain("&quot;x&quot;&amp;님");
  });
});
