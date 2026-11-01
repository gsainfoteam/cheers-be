import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { AdminGraduatedRepository } from "@src/admin-repository/admin-graduated.repository";
import { DatabaseService } from "@src/database/database.service";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { ManagerContext } from "@src/manager/context/manager-context";
import { BusinessCardService } from "./business-card.service";

const GRADUATED_PK = "8f1d2c3b-0000-4000-8000-000000000001";
const KEY = "business-card/user/card.jpg";
const NOW = new Date("2026-10-31T00:00:00Z");

describe("BusinessCardService", () => {
  const tx = {} as TxType;
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const fileService = { getPresignedUrl: jest.fn(), deleteFile: jest.fn() };
  const adminGraduatedRepository = {
    findPage: jest.fn(),
    findCardByPk: jest.fn(),
    findForUpdate: jest.fn(),
    clearVerification: jest.fn(),
  };
  const adminAccessLogRepository = { insert: jest.fn() };
  const service = new BusinessCardService(
    dbService as unknown as DatabaseService,
    fileService as unknown as FileService,
    adminGraduatedRepository as unknown as AdminGraduatedRepository,
    adminAccessLogRepository as unknown as AdminAccessLogRepository,
  );
  const manager = new ManagerContext("me", "me@gm.gist.ac.kr", "admin");

  beforeEach(() => jest.resetAllMocks());

  describe("list", () => {
    const row = {
      graduatedPk: GRADUATED_PK,
      name: "박현업",
      nickname: "현업",
      company: "인포테크",
      job: "개발자",
      hasBusinessCard: true,
      verifiedAt: NOW,
      status: "active",
      withdrawRequestedAt: null,
    };

    it("페이지를 offset으로 바꾸고 행을 DTO로 변환", async () => {
      adminGraduatedRepository.findPage.mockResolvedValue({
        rows: [row],
        total: 21,
      });

      await expect(service.list({ page: 2, size: 20 })).resolves.toEqual({
        items: [
          {
            graduated_pk: GRADUATED_PK,
            name: "박현업",
            nickname: "현업",
            company: "인포테크",
            job: "개발자",
            has_business_card: true,
            verified_at: NOW,
            signup_status: "active",
          },
        ],
        page: 2,
        size: 20,
        total: 21,
      });
      expect(adminGraduatedRepository.findPage).toHaveBeenCalledWith(20, 20);
    });

    it("탈퇴 유예기간 중이면 signup_status = withdrawal_requested", async () => {
      adminGraduatedRepository.findPage.mockResolvedValue({
        rows: [{ ...row, withdrawRequestedAt: NOW }],
        total: 1,
      });

      const { items } = await service.list({ page: 1, size: 20 });

      expect(items[0].signup_status).toBe("withdrawal_requested");
    });
  });

  describe("getImageUrl", () => {
    it("기록을 남긴 뒤 60초짜리 URL을 발급", async () => {
      const calls: string[] = [];
      adminGraduatedRepository.findCardByPk.mockResolvedValue({
        businessCardKey: KEY,
      });
      adminAccessLogRepository.insert.mockImplementation(async () => {
        calls.push("log");
      });
      fileService.getPresignedUrl.mockImplementation(async () => {
        calls.push("sign");
        return "https://signed";
      });

      await expect(service.getImageUrl(GRADUATED_PK, manager)).resolves.toEqual(
        { url: "https://signed", expires_in: 60 },
      );
      expect(calls).toEqual(["log", "sign"]);
      expect(adminAccessLogRepository.insert).toHaveBeenCalledWith({
        adminEmail: "me@gm.gist.ac.kr",
        targetType: "business_card",
        targetId: GRADUATED_PK,
      });
      expect(fileService.getPresignedUrl).toHaveBeenCalledWith(KEY, 60);
    });

    it("기록 저장에 실패하면 URL을 발급하지 않음", async () => {
      const failure = new Error("db down");
      adminGraduatedRepository.findCardByPk.mockResolvedValue({
        businessCardKey: KEY,
      });
      adminAccessLogRepository.insert.mockRejectedValue(failure);

      await expect(service.getImageUrl(GRADUATED_PK, manager)).rejects.toBe(
        failure,
      );
      expect(fileService.getPresignedUrl).not.toHaveBeenCalled();
    });

    it("현업자가 없으면 404, 기록 없음", async () => {
      adminGraduatedRepository.findCardByPk.mockResolvedValue(null);

      await expect(
        service.getImageUrl(GRADUATED_PK, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(adminAccessLogRepository.insert).not.toHaveBeenCalled();
    });

    it("명함이 없으면 404, 기록 없음", async () => {
      adminGraduatedRepository.findCardByPk.mockResolvedValue({
        businessCardKey: null,
      });

      await expect(
        service.getImageUrl(GRADUATED_PK, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(adminAccessLogRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe("cancelVerification", () => {
    it("트랜잭션 안에서 인증을 지우고 S3 파일은 건드리지 않음", async () => {
      adminGraduatedRepository.findForUpdate.mockResolvedValue({
        verifiedAt: NOW,
      });

      await service.cancelVerification(GRADUATED_PK, manager);

      expect(adminGraduatedRepository.findForUpdate).toHaveBeenCalledWith(
        GRADUATED_PK,
        tx,
      );
      expect(adminGraduatedRepository.clearVerification).toHaveBeenCalledWith(
        GRADUATED_PK,
        tx,
      );
      expect(fileService.deleteFile).not.toHaveBeenCalled();
    });

    it("현업자가 없으면 404", async () => {
      adminGraduatedRepository.findForUpdate.mockResolvedValue(null);

      await expect(
        service.cancelVerification(GRADUATED_PK, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(adminGraduatedRepository.clearVerification).not.toHaveBeenCalled();
    });

    it("이미 인증 전이면 409", async () => {
      adminGraduatedRepository.findForUpdate.mockResolvedValue({
        verifiedAt: null,
      });

      await expect(
        service.cancelVerification(GRADUATED_PK, manager),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(adminGraduatedRepository.clearVerification).not.toHaveBeenCalled();
    });
  });
});
