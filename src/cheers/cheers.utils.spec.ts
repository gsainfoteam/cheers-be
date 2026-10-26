import { buildCoffeeChatRequestedMail } from "@src/mail/templates/coffee-chat-requested.template";
import { randomSeed, toOffset, toRequestStatus } from "./cheers.utils";

describe("cheers utils", () => {
  const at = new Date("2026-10-25T12:00:00.000Z");

  it.each([
    [{ graduatedViewedAt: null, contactSharedAt: null }, "requested"],
    [{ graduatedViewedAt: at, contactSharedAt: null }, "viewed"],
    [{ graduatedViewedAt: at, contactSharedAt: at }, "contact_shared"],
    // 상세를 열지 않고 공유해도 공유가 우선
    [{ graduatedViewedAt: null, contactSharedAt: at }, "contact_shared"],
  ])("toRequestStatus(%o) = %s", (row, expected) => {
    expect(toRequestStatus(row)).toBe(expected);
  });

  it("randomSeed changes only at interval boundaries", () => {
    const seed = (iso: string, minutes: number) =>
      randomSeed(new Date(iso), minutes);

    expect(seed("2026-10-26T10:00:00Z", 10)).toBe(
      seed("2026-10-26T10:09:59Z", 10),
    );
    expect(seed("2026-10-26T10:00:00Z", 10)).not.toBe(
      seed("2026-10-26T10:10:00Z", 10),
    );
  });

  it("toOffset", () => {
    expect(toOffset(1, 20)).toBe(0);
    expect(toOffset(3, 20)).toBe(40);
  });
});

describe("buildCoffeeChatRequestedMail", () => {
  it("includes the recipient name and the link", () => {
    const mail = buildCoffeeChatRequestedMail(
      "chulsoo@example.com",
      "김철수",
      "https://cheers.example.com/cheers/received/abc",
    );

    expect(mail.to).toBe("chulsoo@example.com");
    expect(mail.subject).toContain("커피챗 요청");
    expect(mail.text).toContain("김철수님");
    expect(mail.text).toContain(
      "https://cheers.example.com/cheers/received/abc",
    );
    expect(mail.html).toContain(
      'href="https://cheers.example.com/cheers/received/abc"',
    );
  });

  it("escapes the name in html", () => {
    const mail = buildCoffeeChatRequestedMail("a@example.com", "<b>", null);

    expect(mail.html).toContain("&lt;b&gt;님");
    expect(mail.html).not.toContain("<a ");
  });
});
