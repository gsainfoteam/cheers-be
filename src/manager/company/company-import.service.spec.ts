import { BadRequestException, ConflictException } from "@nestjs/common";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { AdminCompanyRepository } from "@src/admin-repository/admin-company.repository";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CompanyImportService } from "./company-import.service";

const file = {
  originalname: "companies.csv",
  buffer: Buffer.from("company name,alias1\nAcme,에크미"),
};

const manager = new ManagerContext("pk", "me@gm.gist.ac.kr", "admin");

describe("CompanyImportService", () => {
  const tx = {} as TxType;
  const auditLogRepository = { insert: jest.fn() };
  const db = { transaction: jest.fn() };
  const repository = {
    findNamesByNormalized: jest.fn(),
    findByPksForUpdate: jest.fn(),
    lockNames: jest.fn(),
    insertAlias: jest.fn(),
    insertNames: jest.fn(),
  };
  const service = new CompanyImportService(
    { db } as unknown as DatabaseService,
    repository as unknown as AdminCompanyRepository,
    auditLogRepository as unknown as AdminAuditLogRepository,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    db.transaction.mockImplementation((fn: (tx: TxType) => unknown) => fn(tx));
    repository.findNamesByNormalized.mockResolvedValue([]);
    repository.insertAlias.mockResolvedValue({ pk: 10 });
  });

  it("미리보기는 읽기만 함", async () => {
    expect(await service.preview(file)).toMatchObject({
      valid: true,
      created_companies: 1,
    });
    expect(repository.lockNames).not.toHaveBeenCalled();
    expect(repository.insertAlias).not.toHaveBeenCalled();
    expect(repository.insertNames).not.toHaveBeenCalled();
  });

  it.each(["40001", "40P01", "23505"])(
    "%s 실패는 새 serializable 트랜잭션으로 재검증",
    async (code) => {
      db.transaction.mockRejectedValueOnce({ cause: { code } });
      await expect(service.commit(file, manager)).resolves.toMatchObject({
        valid: true,
        created_companies: 1,
      });
      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(db.transaction).toHaveBeenLastCalledWith(expect.any(Function), {
        isolationLevel: "serializable",
      });
      expect(repository.insertNames).toHaveBeenCalledWith(
        10,
        [
          { name: "Acme", normalizedName: "acme" },
          { name: "에크미", normalizedName: "에크미" },
        ],
        tx,
      );
    },
  );

  it("저장한 요약만 감사 로그로 같은 트랜잭션에 남김 (파일 내용은 제외)", async () => {
    await service.commit(file, manager);

    expect(auditLogRepository.insert).toHaveBeenCalledWith(
      {
        adminEmail: "me@gm.gist.ac.kr",
        action: "company.import",
        targetType: "company",
        after: {
          created_companies: 1,
          updated_companies: 0,
          added_names: 2,
          skipped_rows: 0,
        },
      },
      tx,
    );
  });

  it("감사 로그 저장이 실패하면 등록도 실패", async () => {
    auditLogRepository.insert.mockRejectedValue(new Error("db down"));

    await expect(service.commit(file, manager)).rejects.toThrow("db down");
  });

  it("기존 회사 행을 잠근 뒤 표기를 잠그고 다시 조회", async () => {
    const calls: string[] = [];
    repository.findNamesByNormalized.mockImplementation(async () => {
      calls.push("read");
      return [{ normalizedName: "acme", aliasPk: 1, aliasName: "Acme" }];
    });
    repository.findByPksForUpdate.mockImplementation(async () => {
      calls.push("companies");
    });
    repository.lockNames.mockImplementation(async () => {
      calls.push("names");
    });
    await service.commit(file, manager);
    expect(calls).toEqual(["read", "companies", "names", "read"]);
    expect(repository.insertAlias).not.toHaveBeenCalled();
    expect(repository.insertNames).toHaveBeenCalledWith(
      1,
      [{ name: "에크미", normalizedName: "에크미" }],
      tx,
    );
  });

  it("세 번 경합하면 409, 그 외 DB 오류는 재시도하지 않음", async () => {
    db.transaction.mockRejectedValue({ code: "40001" });
    await expect(service.commit(file, manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.transaction).toHaveBeenCalledTimes(3);
    db.transaction
      .mockClear()
      .mockRejectedValue(new Error("database unavailable"));
    await expect(service.commit(file, manager)).rejects.toThrow(
      "database unavailable",
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("충돌이 있으면 아무 행도 쓰지 않고 400", async () => {
    repository.findNamesByNormalized.mockResolvedValue([
      { normalizedName: "acme", aliasPk: 1, aliasName: "Acme" },
      { normalizedName: "에크미", aliasPk: 2, aliasName: "다른회사" },
    ]);
    await expect(service.commit(file, manager)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.insertAlias).not.toHaveBeenCalled();
    expect(repository.insertNames).not.toHaveBeenCalled();
    expect(auditLogRepository.insert).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
