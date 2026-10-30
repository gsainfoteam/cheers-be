import { ConfigService } from "@nestjs/config";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { FileService } from "./file.service";
import { OrphanFileService } from "./orphan-file.service";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-31T00:00:00Z");
const OLD = new Date(NOW.getTime() - 25 * HOUR_MS);
const RECENT = new Date(NOW.getTime() - 23 * HOUR_MS);

const file = (key: string, lastModified: Date | undefined = OLD) => ({
  key,
  lastModified,
});

describe("OrphanFileService", () => {
  const fileService = { listFiles: jest.fn(), deleteFile: jest.fn() };
  const graduatedRepository = { findExistingBusinessCardKeys: jest.fn() };
  const attachmentRepository = { findExistingFileKeys: jest.fn() };
  // prefix별 페이지. 없으면 빈 목록
  let pages: Record<string, { files: unknown[]; nextToken?: string }[]>;

  const createService = (env: Record<string, string> = {}) =>
    new OrphanFileService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      fileService as unknown as FileService,
      graduatedRepository as unknown as GraduatedRepository,
      attachmentRepository as unknown as StudentProfileAttachmentRepository,
    );
  const enabled = { S3_ORPHAN_DELETE_ENABLED: "true" };

  beforeEach(() => {
    jest.resetAllMocks();
    pages = {};
    fileService.listFiles.mockImplementation(
      (prefix: string, token?: string) => {
        const index = token ? Number(token) : 0;
        return Promise.resolve(
          pages[prefix]?.[index] ?? { files: [], nextToken: undefined },
        );
      },
    );
    graduatedRepository.findExistingBusinessCardKeys.mockResolvedValue([]);
    attachmentRepository.findExistingFileKeys.mockResolvedValue([]);
    fileService.deleteFile.mockResolvedValue(undefined);
  });

  it("does not delete anything unless explicitly enabled", async () => {
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];

    const result = await createService().cleanup(NOW);

    expect(fileService.deleteFile).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, orphans: 1, deleted: 0, failed: 0 });
  });

  it("treats values other than true as disabled", async () => {
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];

    await createService({ S3_ORPHAN_DELETE_ENABLED: "1" }).cleanup(NOW);

    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes old unreferenced files and keeps referenced ones per prefix", async () => {
    pages["business-card/"] = [
      {
        files: [
          file("business-card/u/keep.jpg"),
          file("business-card/u/x.jpg"),
        ],
      },
    ];
    pages["attachment/"] = [
      { files: [file("attachment/u/keep.pdf"), file("attachment/u/x.pdf")] },
    ];
    graduatedRepository.findExistingBusinessCardKeys.mockResolvedValue([
      "business-card/u/keep.jpg",
    ]);
    attachmentRepository.findExistingFileKeys.mockResolvedValue([
      "attachment/u/keep.pdf",
    ]);

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.deleteFile.mock.calls.map(([key]) => key)).toEqual([
      "business-card/u/x.jpg",
      "attachment/u/x.pdf",
    ]);
    expect(result).toEqual({ scanned: 4, orphans: 2, deleted: 2, failed: 0 });
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
    ).toHaveBeenCalledWith(["business-card/u/old.jpg"]);
    expect(result.scanned).toBe(3);
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
      { files: [file("attachment/u/1.pdf")], nextToken: "1" },
      { files: [file("attachment/u/2.pdf")], nextToken: "2" },
      { files: [file("attachment/u/3.pdf")] },
    ];

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.listFiles).toHaveBeenCalledWith("attachment/", "1");
    expect(fileService.listFiles).toHaveBeenCalledWith("attachment/", "2");
    expect(fileService.deleteFile).toHaveBeenCalledTimes(3);
    expect(result.scanned).toBe(3);
  });

  it("keeps going when some deletes fail and counts them", async () => {
    pages["attachment/"] = [
      {
        files: [
          file("attachment/u/1.pdf"),
          file("attachment/u/2.pdf"),
          file("attachment/u/3.pdf"),
        ],
      },
    ];
    fileService.deleteFile.mockRejectedValueOnce(new Error("S3 down"));

    const result = await createService(enabled).cleanup(NOW);

    expect(fileService.deleteFile).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ scanned: 3, orphans: 3, deleted: 2, failed: 1 });
  });

  it("deletes nothing when a later listing fails", async () => {
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];
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
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];
    pages["attachment/"] = [{ files: [file("attachment/u/a.pdf")] }];
    attachmentRepository.findExistingFileKeys.mockRejectedValue(
      new Error("db down"),
    );

    await expect(createService(enabled).cleanup(NOW)).rejects.toThrow(
      "db down",
    );
    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes nothing when candidates exceed the limit, even in a later prefix", async () => {
    pages["business-card/"] = [{ files: [file("business-card/u/a.jpg")] }];
    pages["attachment/"] = [
      { files: [file("attachment/u/a.pdf"), file("attachment/u/b.pdf")] },
    ];

    await expect(
      createService({ ...enabled, S3_ORPHAN_MAX_DELETES: "2" }).cleanup(NOW),
    ).rejects.toThrow("Too many orphan candidates");
    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes when candidates are exactly at the limit", async () => {
    pages["attachment/"] = [
      { files: [file("attachment/u/a.pdf"), file("attachment/u/b.pdf")] },
    ];

    const result = await createService({
      ...enabled,
      S3_ORPHAN_MAX_DELETES: "2",
    }).cleanup(NOW);

    expect(result.deleted).toBe(2);
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "rejects S3_ORPHAN_MAX_DELETES=%s",
    (value) => {
      expect(() => createService({ S3_ORPHAN_MAX_DELETES: value })).toThrow(
        "S3_ORPHAN_MAX_DELETES",
      );
    },
  );
});
