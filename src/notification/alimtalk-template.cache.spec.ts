import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlimtalkTemplateCache } from "./alimtalk-template.cache";
import { AlimtalkTemplateRepository } from "./alimtalk-template.repository";

const row = (event: string, title = "제목") => ({
  event,
  tplCode: "TPL",
  title,
  message: "본문",
  buttonName: "버튼",
  updatedAt: new Date(),
});

describe("AlimtalkTemplateCache", () => {
  const repository = { findAll: jest.fn(), fillEmptyTplCode: jest.fn() };
  const env: Record<string, string | undefined> = {};
  const cache = new AlimtalkTemplateCache(
    repository as unknown as AlimtalkTemplateRepository,
    { get: (key: string) => env[key] } as unknown as ConfigService,
  );
  let warn: jest.SpyInstance;

  const reset = () => {
    // 새 인스턴스로 캐시 상태 초기화
    return new AlimtalkTemplateCache(
      repository as unknown as AlimtalkTemplateRepository,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it("loads all templates once and serves them until the TTL passes", async () => {
    const target = reset();
    repository.findAll.mockResolvedValue([
      row("contact_shared"),
      row("coffee_chat_requested"),
    ]);

    expect((await target.get("contact_shared", 1000))?.event).toBe(
      "contact_shared",
    );
    await target.get("coffee_chat_requested", 1000 + 59_000);
    expect(repository.findAll).toHaveBeenCalledTimes(1);

    await target.get("contact_shared", 1000 + 60_000);
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const target = reset();
    repository.findAll.mockResolvedValue([row("contact_shared")]);

    await Promise.all([
      target.get("contact_shared", 0),
      target.get("contact_shared", 0),
      target.get("coffee_chat_requested", 0),
    ]);

    expect(repository.findAll).toHaveBeenCalledTimes(1);
  });

  it("returns null when the event has no row", async () => {
    const target = reset();
    repository.findAll.mockResolvedValue([row("contact_shared")]);

    expect(await target.get("coffee_chat_requested", 0)).toBeNull();
  });

  it("returns null when the first load fails and retries on the next call", async () => {
    const target = reset();
    repository.findAll.mockRejectedValueOnce(new Error("db down"));
    repository.findAll.mockResolvedValueOnce([row("contact_shared")]);

    expect(await target.get("contact_shared", 0)).toBeNull();
    expect((await target.get("contact_shared", 1))?.event).toBe(
      "contact_shared",
    );
  });

  it("keeps the previous templates when a reload fails", async () => {
    const target = reset();
    repository.findAll.mockResolvedValueOnce([
      row("contact_shared", "옛 제목"),
    ]);
    await target.get("contact_shared", 0);
    repository.findAll.mockRejectedValueOnce(new Error("db down"));

    expect((await target.get("contact_shared", 60_000))?.title).toBe("옛 제목");
  });

  it("refresh reads again immediately and does not throw on failure", async () => {
    const target = reset();
    repository.findAll.mockResolvedValueOnce([
      row("contact_shared", "옛 제목"),
    ]);
    await target.get("contact_shared", 0);

    repository.findAll.mockResolvedValueOnce([
      row("contact_shared", "새 제목"),
    ]);
    await target.refresh(1);
    expect((await target.get("contact_shared", 2))?.title).toBe("새 제목");

    repository.findAll.mockRejectedValueOnce(new Error("db down"));
    await expect(target.refresh(3)).resolves.toBeUndefined();
    expect((await target.get("contact_shared", 4))?.title).toBe("새 제목");
  });

  describe("onApplicationBootstrap", () => {
    it("moves the legacy env template codes into empty rows", async () => {
      env.KAKAO_TEMPLATE_COFFEE_CHAT_REQUESTED = " TPL-REQ ";
      env.KAKAO_TEMPLATE_CONTACT_SHARED = "TPL-SHARED";
      repository.fillEmptyTplCode.mockResolvedValue(true);
      const log = jest.spyOn(Logger.prototype, "log").mockImplementation();

      await cache.onApplicationBootstrap();

      expect(repository.fillEmptyTplCode).toHaveBeenCalledWith(
        "coffee_chat_requested",
        "TPL-REQ",
      );
      expect(repository.fillEmptyTplCode).toHaveBeenCalledWith(
        "contact_shared",
        "TPL-SHARED",
      );
      log.mockRestore();
    });

    it("does nothing without env values and survives repository errors", async () => {
      await cache.onApplicationBootstrap();
      expect(repository.fillEmptyTplCode).not.toHaveBeenCalled();

      env.KAKAO_TEMPLATE_CONTACT_SHARED = "TPL-SHARED";
      repository.fillEmptyTplCode.mockRejectedValue(new Error("db down"));
      const error = jest.spyOn(Logger.prototype, "error").mockImplementation();
      await expect(cache.onApplicationBootstrap()).resolves.toBeUndefined();
      error.mockRestore();
    });
  });
});
