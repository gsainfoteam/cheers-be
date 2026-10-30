import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { SlackService } from "nestjs-slack";
import { FileService } from "./file.service";
import { OrphanFileService } from "./orphan-file.service";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-31T00:00:00Z");
const OLD = new Date(NOW.getTime() - 25 * HOUR_MS);
const RECENT = new Date(NOW.getTime() - 23 * HOUR_MS);
// 참조 중인 파일. 참조가 하나도 없으면 설정 오류로 보고 중단하므로 삭제 테스트에 함께 둠
const KEEP_CARD = "business-card/u/keep.jpg";
const KEEP_ATTACHMENT = "attachment/u/keep.pdf";

const file = (key: string, lastModified: Date | undefined = OLD) => ({
  key,
  lastModified,
});
const attachments = (count: number) =>
  Array.from({ length: count }, (_, i) => file(`attachment/u/${i}.pdf`));

describe("OrphanFileService", () => {
  const fileService = { listFiles: jest.fn(), deleteFile: jest.fn() };
  const slackService = { sendText: jest.fn() };
  const graduatedRepository = { findExistingBusinessCardKeys: jest.fn() };
  const attachmentRepository = { findExistingFileKeys: jest.fn() };
  // prefix별 페이지. 없으면 빈 목록
  let pages: Record<string, { files: unknown[]; nextToken?: string }[]>;
  let logSpy: jest.SpyInstance;

  const createService = (env: Record<string, string> = {}) =>
    new OrphanFileService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      fileService as unknown as FileService,
      slackService as unknown as SlackService,
      graduatedRepository as unknown as GraduatedRepository,
      attachmentRepository as unknown as StudentProfileAttachmentRepository,
    );
  const enabled = { S3_ORPHAN_DELETE_ENABLED: "true" };

  beforeEach(() => {
    jest.resetAllMocks();
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    pages = {};
    fileService.listFiles.mockImplementation(
      (prefix: string, token?: string) => {
        const index = token ? Number(token) : 0;
        return Promise.resolve(
          pages[prefix]?.[index] ?? { files: [], nextToken: undefined },
        );
      },
    );
    graduatedRepository.findExistingBusinessCardKeys.mockImplementation(
      (keys: string[]) => Promise.resolve(keys.filter((k) => k === KEEP_CARD)),
    );
    attachmentRepository.findExistingFileKeys.mockImplementation(
      (keys: string[]) =>
        Promise.resolve(keys.filter((k) => k === KEEP_ATTACHMENT)),
    );
    fileService.deleteFile.mockResolvedValue(undefined);
    slackService.sendText.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("dry run", () => {
    it("does not delete anything unless explicitly enabled", async () => {
      pages["business-card/"] = [
        { files: [file(KEEP_CARD), file("business-card/u/a.jpg")] },
      ];

      const result = await createService().cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result).toEqual({
        scanned: 2,
        orphans: 1,
        deleted: 0,
        failed: 0,
        stopped: false,
      });
    });

    it("treats values other than true as disabled", async () => {
      pages["business-card/"] = [
        { files: [file(KEEP_CARD), file("business-card/u/a.jpg")] },
      ];

      await createService({ S3_ORPHAN_DELETE_ENABLED: "1" }).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
    });

    it("logs every candidate even over the limit", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(3)] },
      ];

      const result = await createService({
        S3_ORPHAN_MAX_DELETES: "2",
      }).cleanup(NOW);

      expect(result.orphans).toBe(3);
      expect(logSpy).toHaveBeenCalledWith(
        "Dry run: orphan file attachment/u/2.pdf",
      );
      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(slackService.sendText).not.toHaveBeenCalled();
    });

    it("logs candidates and reports it would stop on a suspicious scan", async () => {
      pages["attachment/"] = [{ files: attachments(2) }];

      const result = await createService().cleanup(NOW);

      expect(result.stopped).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        "Dry run: orphan file attachment/u/0.pdf",
      );
      expect(fileService.deleteFile).not.toHaveBeenCalled();
    });
  });

  it("deletes old unreferenced files and keeps referenced ones per prefix", async () => {
    pages["business-card/"] = [
      { files: [file(KEEP_CARD), file("business-card/u/x.jpg")] },
    ];
    pages["attachment/"] = [
      { files: [file(KEEP_ATTACHMENT), file("attachment/u/x.pdf")] },
    ];

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.deleteFile.mock.calls.map(([key]) => key)).toEqual([
      "business-card/u/x.jpg",
      "attachment/u/x.pdf",
    ]);
    expect(result).toEqual({
      scanned: 4,
      orphans: 2,
      deleted: 2,
      failed: 0,
      stopped: false,
    });
  });

  it("asks each table only about the keys of its own prefix", async () => {
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];
    pages["attachment/"] = [{ files: [file("attachment/u/a.pdf")] }];

    await createService().cleanup(NOW);

    expect(
      graduatedRepository.findExistingBusinessCardKeys,
    ).toHaveBeenCalledWith(["business-card/u/a.jpg"]);
    expect(attachmentRepository.findExistingFileKeys).toHaveBeenCalledWith([
      "attachment/u/a.pdf",
    ]);
  });

  it("does not delete recent files or files without a modified time", async () => {
    pages["business-card/"] = [
      {
        files: [
          file(KEEP_CARD),
          file("business-card/u/recent.jpg", RECENT),
          { key: "business-card/u/unknown.jpg" },
          file("business-card/u/old.jpg"),
        ],
      },
    ];

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.deleteFile.mock.calls).toEqual([
      ["business-card/u/old.jpg"],
    ]);
    expect(
      graduatedRepository.findExistingBusinessCardKeys,
    ).toHaveBeenCalledWith([KEEP_CARD, "business-card/u/old.jpg"]);
    expect(result.scanned).toBe(4);
  });

  it("lists only the allowed prefixes, never tmp/", async () => {
    await createService(enabled).cleanup(NOW);

    expect(fileService.listFiles.mock.calls.map(([prefix]) => prefix)).toEqual([
      "business-card/",
      "attachment/",
    ]);
  });

  it("follows continuation tokens through every page", async () => {
    pages["attachment/"] = [
      {
        files: [file(KEEP_ATTACHMENT), file("attachment/u/1.pdf")],
        nextToken: "1",
      },
      { files: [file("attachment/u/2.pdf")], nextToken: "2" },
      { files: [file("attachment/u/3.pdf")] },
    ];

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.listFiles).toHaveBeenCalledWith("attachment/", "1");
    expect(fileService.listFiles).toHaveBeenCalledWith("attachment/", "2");
    expect(fileService.deleteFile).toHaveBeenCalledTimes(3);
    expect(result.scanned).toBe(4);
  });

  it("keeps going when some deletes fail and counts them", async () => {
    pages["attachment/"] = [
      { files: [file(KEEP_ATTACHMENT), ...attachments(3)] },
    ];
    fileService.deleteFile.mockRejectedValueOnce(new Error("S3 down"));

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.deleteFile).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      scanned: 4,
      orphans: 3,
      deleted: 2,
      failed: 1,
      stopped: false,
    });
  });

  it("deletes nothing when a later listing fails", async () => {
    pages["business-card/"] = [
      { files: [file(KEEP_CARD), file("business-card/u/a.jpg")] },
    ];
    fileService.listFiles.mockImplementation((prefix: string) =>
      prefix === "attachment/"
        ? Promise.reject(new Error("S3 down"))
        : Promise.resolve(pages[prefix][0]),
    );

    await expect(createService(enabled).cleanup(NOW)).rejects.toThrow(
      "S3 down",
    );
    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes nothing when the reference lookup fails", async () => {
    pages["business-card/"] = [
      { files: [file(KEEP_CARD), file("business-card/u/a.jpg")] },
    ];
    pages["attachment/"] = [{ files: [file("attachment/u/a.pdf")] }];
    attachmentRepository.findExistingFileKeys.mockRejectedValue(
      new Error("db down"),
    );

    await expect(createService(enabled).cleanup(NOW)).rejects.toThrow(
      "db down",
    );
    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  describe("settings mismatch check", () => {
    it("deletes nothing and alerts when no old file is referenced, even with one file", async () => {
      pages["attachment/"] = [{ files: attachments(1) }];

      const result = await createService(enabled).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result.stopped).toBe(true);
      expect(slackService.sendText).toHaveBeenCalledTimes(1);
    });

    it("deletes nothing for an empty DB with many files (under the limit)", async () => {
      pages["attachment/"] = [{ files: attachments(900) }];

      const result = await createService(enabled).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result).toEqual({
        scanned: 900,
        orphans: 900,
        deleted: 0,
        failed: 0,
        stopped: true,
      });
    });

    it("deletes nothing and alerts when orphans are over the ratio", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(10)] },
      ];

      const result = await createService(enabled).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result.stopped).toBe(true);
      expect(slackService.sendText).toHaveBeenCalledTimes(1);
    });

    it("counts both prefixes for the ratio", async () => {
      pages["business-card/"] = [
        {
          files: Array.from({ length: 10 }, (_, i) =>
            file(`business-card/u/${i}.jpg`),
          ),
        },
      ];
      pages["attachment/"] = [{ files: [file(KEEP_ATTACHMENT)] }];

      const result = await createService(enabled).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result.stopped).toBe(true);
    });

    it("ignores recent files in the ratio", async () => {
      const recent = Array.from({ length: 20 }, (_, i) =>
        file(`attachment/u/recent-${i}.pdf`, RECENT),
      );
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...recent, ...attachments(10)] },
      ];

      const result = await createService(enabled).cleanup(NOW);

      expect(result.stopped).toBe(true);
    });

    it("does not check the ratio below the minimum orphan count", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(9)] },
      ];

      const result = await createService(enabled).cleanup(NOW);

      expect(result.deleted).toBe(9);
      expect(result.stopped).toBe(false);
    });

    it("deletes when orphans are exactly at the ratio", async () => {
      const kept = Array.from({ length: 10 }, () => file(KEEP_ATTACHMENT));
      pages["attachment/"] = [{ files: [...kept, ...attachments(10)] }];

      const result = await createService(enabled).cleanup(NOW);

      expect(result.deleted).toBe(10);
      expect(result.stopped).toBe(false);
    });

    it("allows a higher ratio through the env", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(10)] },
      ];

      const result = await createService({
        ...enabled,
        S3_ORPHAN_MAX_RATIO: "1",
      }).cleanup(NOW);

      expect(result.deleted).toBe(10);
    });

    it("still stops when nothing is referenced, whatever the ratio env", async () => {
      pages["attachment/"] = [{ files: attachments(10) }];

      const result = await createService({
        ...enabled,
        S3_ORPHAN_MAX_RATIO: "1",
      }).cleanup(NOW);

      expect(fileService.deleteFile).not.toHaveBeenCalled();
      expect(result.stopped).toBe(true);
    });
  });

  describe("delete limit", () => {
    const limited = { ...enabled, S3_ORPHAN_MAX_DELETES: "2" };

    it("deletes up to the limit and alerts about the rest", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(3)] },
      ];

      const result = await createService(limited).cleanup(NOW);

      expect(fileService.deleteFile).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        scanned: 4,
        orphans: 3,
        deleted: 2,
        failed: 0,
        stopped: false,
      });
      expect(slackService.sendText).toHaveBeenCalledTimes(1);
    });

    it("applies the limit across prefixes and pages", async () => {
      pages["business-card/"] = [
        {
          files: [file(KEEP_CARD), file("business-card/u/a.jpg")],
          nextToken: "1",
        },
        { files: [file("business-card/u/b.jpg")] },
      ];
      pages["attachment/"] = [{ files: [file("attachment/u/a.pdf")] }];

      await createService(limited).cleanup(NOW);

      expect(fileService.deleteFile.mock.calls).toEqual([
        ["business-card/u/a.jpg"],
        ["business-card/u/b.jpg"],
      ]);
    });

    it("does not alert when candidates are exactly at the limit", async () => {
      pages["attachment/"] = [
        { files: [file(KEEP_ATTACHMENT), ...attachments(2)] },
      ];

      const result = await createService(limited).cleanup(NOW);

      expect(result.deleted).toBe(2);
      expect(slackService.sendText).not.toHaveBeenCalled();
    });
  });

  it("does not fail the cleanup when Slack fails", async () => {
    pages["attachment/"] = [{ files: attachments(1) }];
    slackService.sendText.mockRejectedValue(new Error("slack down"));

    await expect(createService(enabled).cleanup(NOW)).resolves.toMatchObject({
      stopped: true,
    });
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "rejects S3_ORPHAN_MAX_DELETES=%s",
    (value) => {
      expect(() => createService({ S3_ORPHAN_MAX_DELETES: value })).toThrow(
        "S3_ORPHAN_MAX_DELETES",
      );
    },
  );

  it.each(["0", "-0.1", "abc", "1.5"])(
    "rejects S3_ORPHAN_MAX_RATIO=%s",
    (value) => {
      expect(() => createService({ S3_ORPHAN_MAX_RATIO: value })).toThrow(
        "S3_ORPHAN_MAX_RATIO",
      );
    },
  );
});
