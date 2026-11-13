import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import {
  AdminCompanyAliasRow,
  AdminCompanyRepository,
  AdminCompanyRow,
} from "@src/admin-repository/admin-company.repository";
import { DatabaseService } from "@src/database/database.service";
import { FilePurpose } from "@src/file/file.constants";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { ManagerContext } from "@src/manager/context/manager-context";
import { AdminCompanyService } from "./admin-company.service";

const MANAGER_PK = "aaaaaaaa-0000-4000-8000-000000000001";
const manager = new ManagerContext(MANAGER_PK, "me@gm.gist.ac.kr", "admin");
const CREATED_AT = new Date("2026-11-01T00:00:00.000Z");

const aliasRow = (
  overrides: Partial<AdminCompanyAliasRow> = {},
): AdminCompanyAliasRow => ({
  pk: 1,
  name: "Microsoft",
  logoKey: null,
  needsReview: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

const detailRow = (
  overrides: Partial<AdminCompanyRow> = {},
): AdminCompanyRow => ({
  ...aliasRow(),
  names: [{ pk: 10, name: "Microsoft" }],
  graduatedCount: 0,
  ...overrides,
});

describe("AdminCompanyService", () => {
  const tx = {} as TxType;
  const dbService = {
    db: { transaction: jest.fn((fn: (tx: TxType) => unknown) => fn(tx)) },
  };
  const repository = {
    findPage: jest.fn(),
    findDetail: jest.fn(),
    findByPksForUpdate: jest.fn(),
    findByPkForUpdate: jest.fn(),
    lockNames: jest.fn(),
    findNamesByNormalized: jest.fn(),
    insertAlias: jest.fn(),
    insertNames: jest.fn(),
    updateAlias: jest.fn(),
    moveNames: jest.fn(),
    moveProfiles: jest.fn(),
    countProfiles: jest.fn(),
    findName: jest.fn(),
    deleteName: jest.fn(),
    deleteAlias: jest.fn(),
  };
  const auditLogRepository = { insert: jest.fn() };
  const fileService = {
    getPresignedUrls: jest.fn(),
    deleteFileQuietly: jest.fn(),
    confirmUpload: jest.fn(),
    createUploadUrl: jest.fn(),
  };
  const service = new AdminCompanyService(
    dbService as unknown as DatabaseService,
    repository as unknown as AdminCompanyRepository,
    fileService as unknown as FileService,
    auditLogRepository as unknown as AdminAuditLogRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    auditLogRepository.insert.mockReset();
    repository.findDetail.mockResolvedValue(detailRow());
    repository.findByPkForUpdate.mockResolvedValue(aliasRow());
    repository.findNamesByNormalized.mockResolvedValue([]);
    repository.insertAlias.mockResolvedValue(aliasRow());
    fileService.getPresignedUrls.mockResolvedValue(new Map());
  });

  describe("list", () => {
    it("filters by the normalized keyword and maps rows", async () => {
      repository.findPage.mockResolvedValue({
        rows: [
          detailRow({
            logoKey: "company-logo/a/l.png",
            needsReview: true,
            graduatedCount: 3,
          }),
        ],
        total: 21,
      });
      fileService.getPresignedUrls.mockResolvedValue(
        new Map([["company-logo/a/l.png", "https://signed"]]),
      );

      const result = await service.list({
        q: "  MicroSoft ",
        page: 2,
        size: 20,
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        { q: "microsoft" },
        20,
        20,
      );
      expect(result).toEqual({
        items: [
          {
            company_id: 1,
            name: "Microsoft",
            logo_url: "https://signed",
            needs_review: true,
            names: [{ name_id: 10, name: "Microsoft" }],
            graduated_count: 3,
            created_at: "2026-11-01T00:00:00.000Z",
          },
        ],
        page: 2,
        size: 20,
        total: 21,
      });
    });
  });

  describe("create", () => {
    it("registers the company name and other names once per normalized name", async () => {
      await service.create(
        {
          name: "Microsoft",
          names: ["마이크로소프트", "MICROSOFT", "마소"],
        },
        manager,
      );

      expect(repository.lockNames).toHaveBeenCalledWith(
        ["microsoft", "마이크로소프트", "마소"],
        tx,
      );
      expect(repository.insertAlias).toHaveBeenCalledWith("Microsoft", tx);
      expect(repository.insertNames).toHaveBeenCalledWith(
        1,
        [
          { name: "Microsoft", normalizedName: "microsoft" },
          { name: "마이크로소프트", normalizedName: "마이크로소프트" },
          { name: "마소", normalizedName: "마소" },
        ],
        tx,
      );
    });

    it("records an audit log in the same transaction", async () => {
      await service.create({ name: "Microsoft" }, manager);

      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company.create",
          targetType: "company",
          targetId: 1,
          after: {
            name: "Microsoft",
            needs_review: false,
            logo_key: null,
            names: ["Microsoft"],
          },
        },
        tx,
      );
    });

    it("fails when the audit log cannot be saved", async () => {
      auditLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(
        service.create({ name: "Microsoft" }, manager),
      ).rejects.toThrow("db down");
    });

    it("throws 409 when a name already belongs to a company", async () => {
      repository.findNamesByNormalized.mockResolvedValue([
        { pk: 5, aliasPk: 2, name: "마소", aliasName: "MS Korea" },
      ]);

      await expect(
        service.create({ name: "Microsoft", names: ["마소"] }, manager),
      ).rejects.toThrow(
        new ConflictException(
          "Company name already registered: 마소 (MS Korea)",
        ),
      );
      expect(repository.insertAlias).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("approves a company under review", async () => {
      await service.update(1, { needs_review: false }, manager);

      expect(repository.updateAlias).toHaveBeenCalledWith(
        1,
        { name: undefined, needsReview: false },
        tx,
      );
      expect(repository.insertNames).not.toHaveBeenCalled();
    });

    it("records before and after in the audit log", async () => {
      repository.findDetail
        .mockResolvedValueOnce(detailRow({ needsReview: true }))
        .mockResolvedValueOnce(detailRow({ needsReview: false }));

      await service.update(1, { needs_review: false }, manager);

      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company.update",
          targetType: "company",
          targetId: 1,
          before: expect.objectContaining({ needs_review: true }),
          after: expect.objectContaining({ needs_review: false }),
        },
        tx,
      );
    });

    it("does not record an audit log when the update is rejected", async () => {
      repository.findNamesByNormalized.mockResolvedValue([
        { pk: 20, aliasPk: 2, name: "Google", aliasName: "Google" },
      ]);

      await expect(
        service.update(1, { name: "google" }, manager),
      ).rejects.toThrow(ConflictException);
      expect(auditLogRepository.insert).not.toHaveBeenCalled();
    });

    it("adds the new name as a searchable name when renaming", async () => {
      await service.update(1, { name: "Microsoft Korea" }, manager);

      expect(repository.insertNames).toHaveBeenCalledWith(
        1,
        [{ name: "Microsoft Korea", normalizedName: "microsoft korea" }],
        tx,
      );
      expect(repository.updateAlias).toHaveBeenCalledWith(
        1,
        { name: "Microsoft Korea", needsReview: undefined },
        tx,
      );
    });

    it("renames to a name it already has without adding it again", async () => {
      repository.findNamesByNormalized.mockResolvedValue([
        { pk: 10, aliasPk: 1, name: "microsoft", aliasName: "Microsoft" },
      ]);

      await service.update(1, { name: "MICROSOFT" }, manager);

      expect(repository.insertNames).not.toHaveBeenCalled();
      expect(repository.updateAlias).toHaveBeenCalled();
    });

    it("throws 409 when the new name belongs to another company", async () => {
      repository.findNamesByNormalized.mockResolvedValue([
        { pk: 20, aliasPk: 2, name: "Google", aliasName: "Google" },
      ]);

      await expect(
        service.update(1, { name: "google" }, manager),
      ).rejects.toThrow(ConflictException);
      expect(repository.updateAlias).not.toHaveBeenCalled();
    });

    it("throws 404 for an unknown company", async () => {
      repository.findByPkForUpdate.mockResolvedValue(null);

      await expect(
        service.update(1, { needs_review: false }, manager),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("addName", () => {
    it("records the names before and after", async () => {
      repository.findDetail
        .mockResolvedValueOnce(detailRow())
        .mockResolvedValueOnce(
          detailRow({
            names: [
              { pk: 10, name: "Microsoft" },
              { pk: 11, name: "마소" },
            ],
          }),
        );

      await service.addName(1, "마소", manager);

      expect(repository.insertNames).toHaveBeenCalledWith(
        1,
        [{ name: "마소", normalizedName: "마소" }],
        tx,
      );
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company_name.add",
          targetType: "company_name",
          targetId: 1,
          before: { company_id: 1, names: ["Microsoft"] },
          after: { company_id: 1, names: ["Microsoft", "마소"] },
        },
        tx,
      );
    });

    it("fails when the audit log cannot be saved", async () => {
      auditLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(service.addName(1, "마소", manager)).rejects.toThrow(
        "db down",
      );
    });
  });

  describe("removeName", () => {
    it("deletes another name of the company", async () => {
      repository.findName.mockResolvedValue({
        pk: 11,
        aliasPk: 1,
        name: "마소",
        normalizedName: "마소",
        createdAt: CREATED_AT,
      });

      await service.removeName(1, 11, manager);

      expect(repository.findName).toHaveBeenCalledWith(1, 11, tx);
      expect(repository.deleteName).toHaveBeenCalledWith(11, tx);
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "company_name.remove",
          targetType: "company_name",
          targetId: 1,
        }),
        tx,
      );
    });

    it("refuses to delete the company's own name", async () => {
      repository.findName.mockResolvedValue({
        pk: 10,
        aliasPk: 1,
        name: "Microsoft",
        normalizedName: "microsoft",
        createdAt: CREATED_AT,
      });

      await expect(service.removeName(1, 10, manager)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.deleteName).not.toHaveBeenCalled();
      expect(auditLogRepository.insert).not.toHaveBeenCalled();
    });

    it("throws 404 for a name of another company", async () => {
      repository.findName.mockResolvedValue(null);

      await expect(service.removeName(1, 99, manager)).rejects.toThrow(
        new NotFoundException("Company name not found"),
      );
    });
  });

  describe("merge", () => {
    const source = aliasRow({
      pk: 2,
      name: "마이크로소프트",
      needsReview: true,
    });
    const target = aliasRow({ pk: 1 });

    it("moves names and profiles to the target and deletes the source", async () => {
      repository.findByPksForUpdate.mockResolvedValue([target, source]);

      await service.merge(2, 1, manager);

      expect(repository.findByPksForUpdate).toHaveBeenCalledWith([2, 1], tx);
      expect(repository.moveNames).toHaveBeenCalledWith(2, 1, tx);
      expect(repository.moveProfiles).toHaveBeenCalledWith(2, 1, tx);
      expect(repository.deleteAlias).toHaveBeenCalledWith(2, tx);
      expect(repository.updateAlias).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("records source and target before and the moved profile count", async () => {
      repository.findByPksForUpdate.mockResolvedValue([target, source]);
      repository.countProfiles.mockResolvedValue(3);
      repository.findDetail
        .mockResolvedValueOnce(
          detailRow({
            pk: 2,
            name: "마이크로소프트",
            names: [{ pk: 20, name: "마이크로소프트" }],
          }),
        )
        .mockResolvedValueOnce(detailRow())
        .mockResolvedValueOnce(
          detailRow({
            names: [
              { pk: 10, name: "Microsoft" },
              { pk: 20, name: "마이크로소프트" },
            ],
          }),
        );

      await service.merge(2, 1, manager);

      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company.merge",
          targetType: "company",
          targetId: 2,
          before: {
            source: {
              name: "마이크로소프트",
              needs_review: false,
              logo_key: null,
              names: ["마이크로소프트"],
            },
            target: {
              name: "Microsoft",
              needs_review: false,
              logo_key: null,
              names: ["Microsoft"],
            },
          },
          after: {
            target: {
              name: "Microsoft",
              needs_review: false,
              logo_key: null,
              names: ["Microsoft", "마이크로소프트"],
            },
            moved_graduated_count: 3,
          },
        },
        tx,
      );
    });

    it("gives the source logo to a target without one", async () => {
      repository.findByPksForUpdate.mockResolvedValue([
        target,
        { ...source, logoKey: "company-logo/a/src.png" },
      ]);

      await service.merge(2, 1, manager);

      expect(repository.updateAlias).toHaveBeenCalledWith(
        1,
        { logoKey: "company-logo/a/src.png" },
        tx,
      );
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("deletes the source logo after commit when the target has one", async () => {
      repository.findByPksForUpdate.mockResolvedValue([
        { ...target, logoKey: "company-logo/a/target.png" },
        { ...source, logoKey: "company-logo/a/src.png" },
      ]);

      await service.merge(2, 1, manager);

      expect(repository.updateAlias).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(
        "company-logo/a/src.png",
      );
    });

    it("rejects merging into itself", async () => {
      await expect(service.merge(1, 1, manager)).rejects.toThrow(
        BadRequestException,
      );
      expect(dbService.db.transaction).not.toHaveBeenCalled();
    });

    it("throws 404 when either company is gone", async () => {
      repository.findByPksForUpdate.mockResolvedValue([target]);

      await expect(service.merge(2, 1, manager)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.moveNames).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes an unused company and its logo after commit", async () => {
      repository.findByPkForUpdate.mockResolvedValue(
        aliasRow({ logoKey: "company-logo/a/l.png" }),
      );
      repository.countProfiles.mockResolvedValue(0);

      await service.remove(1, manager);

      expect(repository.deleteAlias).toHaveBeenCalledWith(1, tx);
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(
        "company-logo/a/l.png",
      );
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company.delete",
          targetType: "company",
          targetId: 1,
          before: expect.objectContaining({ name: "Microsoft" }),
        },
        tx,
      );
    });

    it("keeps the logo file when the audit log cannot be saved", async () => {
      repository.findByPkForUpdate.mockResolvedValue(
        aliasRow({ logoKey: "company-logo/a/l.png" }),
      );
      repository.countProfiles.mockResolvedValue(0);
      auditLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(service.remove(1, manager)).rejects.toThrow("db down");
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("throws 409 for a company picked by graduates", async () => {
      repository.countProfiles.mockResolvedValue(2);

      await expect(service.remove(1, manager)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.deleteAlias).not.toHaveBeenCalled();
    });
  });

  describe("logo", () => {
    it("issues an upload URL under the manager's folder", async () => {
      fileService.createUploadUrl.mockResolvedValue({
        url: "https://put",
        key: `tmp/company-logo/${MANAGER_PK}/x.png`,
        headers: { "Content-Type": "image/png" },
        expiresIn: 300,
      });

      await expect(
        service.createLogoUploadUrl(MANAGER_PK, "image/png", 1000),
      ).resolves.toEqual({
        url: "https://put",
        method: "PUT",
        key: `tmp/company-logo/${MANAGER_PK}/x.png`,
        headers: { "Content-Type": "image/png" },
        expires_in: 300,
      });
      expect(fileService.createUploadUrl).toHaveBeenCalledWith(
        MANAGER_PK,
        FilePurpose.COMPANY_LOGO,
        "image/png",
        1000,
      );
    });

    it("confirms the upload, links it and deletes the previous logo after commit", async () => {
      fileService.confirmUpload.mockResolvedValue("company-logo/a/new.png");
      repository.findByPkForUpdate.mockResolvedValue(
        aliasRow({ logoKey: "company-logo/a/old.png" }),
      );

      await service.updateLogo(1, "tmp/company-logo/a/new.png", manager);

      expect(fileService.confirmUpload).toHaveBeenCalledWith(
        MANAGER_PK,
        FilePurpose.COMPANY_LOGO,
        "tmp/company-logo/a/new.png",
      );
      expect(repository.updateAlias).toHaveBeenCalledWith(
        1,
        { logoKey: "company-logo/a/new.png" },
        tx,
      );
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(
        "company-logo/a/old.png",
      );
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "company.logo_update",
          targetType: "company",
          targetId: 1,
          before: { logo_key: "company-logo/a/old.png" },
          after: { logo_key: "company-logo/a/new.png" },
        },
        tx,
      );
    });

    it("keeps the confirmed file when the company is gone", async () => {
      fileService.confirmUpload.mockResolvedValue("company-logo/a/new.png");
      repository.findByPkForUpdate.mockResolvedValue(null);

      await expect(
        service.updateLogo(1, "tmp/company-logo/a/new.png", manager),
      ).rejects.toThrow(NotFoundException);
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });
  });
});
