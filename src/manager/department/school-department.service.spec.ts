import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AdminDepartmentRepository } from "@src/admin-repository/admin-department.repository";
import { AdminSchoolEmailDomainRepository } from "@src/admin-repository/admin-school-email-domain.repository";
import { AdminSchoolRepository } from "@src/admin-repository/admin-school.repository";
import { AdminStudentRepository } from "@src/admin-repository/admin-student.repository";
import { DatabaseService } from "@src/database/database.service";
import { SchoolDepartmentService } from "@src/manager/department/school-department.service";

const school = { pk: 1, name: "GIST" };
const domainRow = (domain: string, schoolPk = 1) => ({
  pk: 1,
  schoolPk,
  domain,
});
const departmentRow = { pk: 5, schoolPk: 1, name: "AI학과", isActive: true };
const uniqueViolation = Object.assign(new Error("duplicate"), {
  cause: { code: "23505" },
});

describe("SchoolDepartmentService", () => {
  const tx = { tx: true };
  const dbService = {
    db: { transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) },
  };
  const schoolRepository = {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findByPkForUpdate: jest.fn(),
  };
  const domainRepository = {
    findAll: jest.fn(),
    findBySchoolPk: jest.fn(),
    deleteBySchoolPkAndDomains: jest.fn(),
    insertMany: jest.fn(),
  };
  const departmentRepository = {
    findBySchoolPk: jest.fn(),
    insertIfAbsent: jest.fn(),
    update: jest.fn(),
    existsActiveBySchoolPk: jest.fn(),
  };
  const studentRepository = { existsByEmailDomain: jest.fn() };
  const service = new SchoolDepartmentService(
    dbService as unknown as DatabaseService,
    schoolRepository as unknown as AdminSchoolRepository,
    domainRepository as unknown as AdminSchoolEmailDomainRepository,
    departmentRepository as unknown as AdminDepartmentRepository,
    studentRepository as unknown as AdminStudentRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    dbService.db.transaction.mockImplementation((fn) => fn(tx));
    schoolRepository.findByPk.mockResolvedValue(school);
    schoolRepository.findByPkForUpdate.mockResolvedValue(school);
    domainRepository.findBySchoolPk.mockResolvedValue([
      domainRow("gm.gist.ac.kr"),
    ]);
    studentRepository.existsByEmailDomain.mockResolvedValue(false);
  });

  it("groups email domains by school", async () => {
    schoolRepository.findAll.mockResolvedValue([
      school,
      { pk: 2, name: "다른 학교" },
    ]);
    domainRepository.findAll.mockResolvedValue([
      domainRow("a.ac.kr"),
      domainRow("b.ac.kr", 2),
      domainRow("c.ac.kr"),
    ]);

    await expect(service.listSchools()).resolves.toEqual([
      { pk: 1, name: "GIST", email_domains: ["a.ac.kr", "c.ac.kr"] },
      { pk: 2, name: "다른 학교", email_domains: ["b.ac.kr"] },
    ]);
  });

  describe("departments", () => {
    it("returns 404 for an unknown school", async () => {
      schoolRepository.findByPk.mockResolvedValue(null);

      await expect(service.listDepartments(9)).rejects.toThrow(
        new NotFoundException("School not found."),
      );
      await expect(
        service.createDepartment(9, { name: "새 학과" }),
      ).rejects.toThrow(new NotFoundException("School not found."));
      expect(departmentRepository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("lists inactive departments too", async () => {
      departmentRepository.findBySchoolPk.mockResolvedValue([
        departmentRow,
        { ...departmentRow, pk: 6, name: "옛 학과", isActive: false },
      ]);

      await expect(service.listDepartments(1)).resolves.toEqual([
        { pk: 5, school_pk: 1, name: "AI학과", is_active: true },
        { pk: 6, school_pk: 1, name: "옛 학과", is_active: false },
      ]);
    });

    it("returns 409 when adding a duplicate name", async () => {
      departmentRepository.insertIfAbsent.mockResolvedValue(null);

      await expect(
        service.createDepartment(1, { name: "AI학과" }),
      ).rejects.toThrow(
        new ConflictException("Department name already exists in this school."),
      );
    });

    it("returns 400 when there is nothing to update", async () => {
      await expect(service.updateDepartment(1, 5, {})).rejects.toThrow(
        new BadRequestException("Nothing to update."),
      );
      expect(departmentRepository.update).not.toHaveBeenCalled();
    });

    it("updates only the sent fields", async () => {
      departmentRepository.update.mockResolvedValue({
        ...departmentRow,
        isActive: false,
      });
      departmentRepository.existsActiveBySchoolPk.mockResolvedValue(true);

      await expect(
        service.updateDepartment(1, 5, { is_active: false }),
      ).resolves.toEqual({
        pk: 5,
        school_pk: 1,
        name: "AI학과",
        is_active: false,
      });
      expect(schoolRepository.findByPkForUpdate).toHaveBeenCalledWith(1, tx);
      expect(departmentRepository.update).toHaveBeenCalledWith(
        1,
        5,
        { name: undefined, isActive: false },
        tx,
      );
    });

    it("returns 409 when deactivating the last active department", async () => {
      departmentRepository.update.mockResolvedValue({
        ...departmentRow,
        isActive: false,
      });
      departmentRepository.existsActiveBySchoolPk.mockResolvedValue(false);

      await expect(
        service.updateDepartment(1, 5, { is_active: false }),
      ).rejects.toThrow(
        new ConflictException("At least one active department is required."),
      );
    });

    it("does not lock or check active departments for a rename or reactivation", async () => {
      departmentRepository.update.mockResolvedValue(departmentRow);

      await service.updateDepartment(1, 5, { name: "새 이름" });
      await service.updateDepartment(1, 5, { is_active: true });

      expect(schoolRepository.findByPkForUpdate).not.toHaveBeenCalled();
      expect(
        departmentRepository.existsActiveBySchoolPk,
      ).not.toHaveBeenCalled();
    });

    it("returns 404 when deactivating a department of another school", async () => {
      departmentRepository.update.mockResolvedValue(null);

      await expect(
        service.updateDepartment(2, 5, { is_active: false }),
      ).rejects.toThrow(new NotFoundException("Department not found."));
      expect(
        departmentRepository.existsActiveBySchoolPk,
      ).not.toHaveBeenCalled();
    });

    it("returns 404 for a department of another school", async () => {
      departmentRepository.update.mockResolvedValue(null);

      await expect(
        service.updateDepartment(2, 5, { name: "새 이름" }),
      ).rejects.toThrow(new NotFoundException("Department not found."));
    });

    it("returns 409 when renaming to a name that already exists", async () => {
      departmentRepository.update.mockRejectedValue(uniqueViolation);

      await expect(
        service.updateDepartment(1, 5, { name: "화학과" }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Department name already exists in this school.",
      });
    });

    it("passes on other database errors", async () => {
      departmentRepository.update.mockRejectedValue(new Error("db down"));

      await expect(
        service.updateDepartment(1, 5, { name: "화학과" }),
      ).rejects.toThrow("db down");
    });
  });

  describe("replaceEmailDomains", () => {
    it("removes and adds only the difference in one transaction", async () => {
      domainRepository.findBySchoolPk
        .mockResolvedValueOnce([
          domainRow("keep.ac.kr"),
          domainRow("old.ac.kr"),
        ])
        .mockResolvedValueOnce([
          domainRow("keep.ac.kr"),
          domainRow("new.ac.kr"),
        ]);

      await expect(
        service.replaceEmailDomains(1, {
          email_domains: ["keep.ac.kr", "new.ac.kr"],
        }),
      ).resolves.toEqual({
        pk: 1,
        name: "GIST",
        email_domains: ["keep.ac.kr", "new.ac.kr"],
      });

      expect(schoolRepository.findByPkForUpdate).toHaveBeenCalledWith(1, tx);
      expect(studentRepository.existsByEmailDomain).toHaveBeenCalledTimes(1);
      expect(studentRepository.existsByEmailDomain).toHaveBeenCalledWith(
        "old.ac.kr",
        tx,
      );
      expect(domainRepository.deleteBySchoolPkAndDomains).toHaveBeenCalledWith(
        1,
        ["old.ac.kr"],
        tx,
      );
      expect(domainRepository.insertMany).toHaveBeenCalledWith(
        1,
        ["new.ac.kr"],
        tx,
      );
    });

    it("writes nothing when the list is unchanged", async () => {
      await service.replaceEmailDomains(1, {
        email_domains: ["gm.gist.ac.kr"],
      });

      expect(
        domainRepository.deleteBySchoolPkAndDomains,
      ).not.toHaveBeenCalled();
      expect(domainRepository.insertMany).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown school", async () => {
      schoolRepository.findByPkForUpdate.mockResolvedValue(null);

      await expect(
        service.replaceEmailDomains(9, { email_domains: ["a.ac.kr"] }),
      ).rejects.toThrow(new NotFoundException("School not found."));
    });

    it("returns 409 when removing a domain verified students use, checking after the delete", async () => {
      studentRepository.existsByEmailDomain.mockResolvedValue(true);

      await expect(
        service.replaceEmailDomains(1, { email_domains: ["new.ac.kr"] }),
      ).rejects.toThrow(
        new ConflictException(
          "Email domain is in use by verified students: gm.gist.ac.kr",
        ),
      );
      // 지운 행은 예외로 rollback됨 (e2e에서 확인). 인증 완료와의 경합을 막으려고 지운 뒤에 검사
      expect(
        domainRepository.deleteBySchoolPkAndDomains.mock.invocationCallOrder[0],
      ).toBeLessThan(
        studentRepository.existsByEmailDomain.mock.invocationCallOrder[0],
      );
      expect(domainRepository.insertMany).not.toHaveBeenCalled();
    });

    it("returns 409 when the domain belongs to another school", async () => {
      domainRepository.insertMany.mockRejectedValue(uniqueViolation);

      await expect(
        service.replaceEmailDomains(1, {
          email_domains: ["gm.gist.ac.kr", "other.ac.kr"],
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Email domain is already used by another school.",
      });
    });
  });
});
