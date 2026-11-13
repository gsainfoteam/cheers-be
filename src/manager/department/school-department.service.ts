import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import {
  AdminDepartmentRepository,
  AdminDepartmentRow,
} from "@src/admin-repository/admin-department.repository";
import { AdminSchoolEmailDomainRepository } from "@src/admin-repository/admin-school-email-domain.repository";
import {
  AdminSchoolRepository,
  AdminSchoolRow,
} from "@src/admin-repository/admin-school.repository";
import { AdminStudentRepository } from "@src/admin-repository/admin-student.repository";
import { DatabaseService } from "@src/database/database.service";
import { isUniqueViolation } from "@src/global/exceptions/pg-error";
import { ManagerContext } from "@src/manager/context/manager-context";
import { AdminAuditSnapshot } from "@drizzle/schema/admin-audit-log";
import {
  CreateDepartmentRequestDto,
  DepartmentAdminDto,
  ReplaceEmailDomainsRequestDto,
  SchoolDto,
  UpdateDepartmentRequestDto,
} from "@src/manager/department/dto/school-department.dto";

const SCHOOL_NOT_FOUND = "School not found.";
const DEPARTMENT_NAME_EXISTS = "Department name already exists in this school.";

@Injectable()
export class SchoolDepartmentService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly schoolRepository: AdminSchoolRepository,
    private readonly schoolEmailDomainRepository: AdminSchoolEmailDomainRepository,
    private readonly departmentRepository: AdminDepartmentRepository,
    private readonly studentRepository: AdminStudentRepository,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async listSchools(): Promise<SchoolDto[]> {
    const [schools, domains] = await Promise.all([
      this.schoolRepository.findAll(),
      this.schoolEmailDomainRepository.findAll(),
    ]);
    return schools.map((school) =>
      this.toSchoolDto(
        school,
        domains.filter((d) => d.schoolPk === school.pk).map((d) => d.domain),
      ),
    );
  }

  async listDepartments(schoolPk: number): Promise<DepartmentAdminDto[]> {
    await this.findSchool(schoolPk);
    const departments =
      await this.departmentRepository.findBySchoolPk(schoolPk);
    return departments.map((department) => this.toDepartmentDto(department));
  }

  // 쓰기는 감사 로그(CRB-81)를 변경과 같은 트랜잭션에서 남김. 기록이 실패하면 변경도 되돌림
  async createDepartment(
    schoolPk: number,
    req: CreateDepartmentRequestDto,
    manager: ManagerContext,
  ): Promise<DepartmentAdminDto> {
    await this.findSchool(schoolPk);
    const department = await this.dbService.db.transaction(async (tx) => {
      const created = await this.departmentRepository.insertIfAbsent(
        schoolPk,
        req.name,
        tx,
      );
      if (!created) {
        throw new ConflictException(DEPARTMENT_NAME_EXISTS);
      }
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "school_department.create",
          targetType: "school_department",
          targetId: created.pk,
          after: this.toDepartmentSnapshot(created),
        },
        tx,
      );
      return created;
    });
    return this.toDepartmentDto(department);
  }

  // 행을 지우지 않으므로 이미 고른 학생의 프로필 · 조회는 그대로 유지됨
  async updateDepartment(
    schoolPk: number,
    departmentPk: number,
    req: UpdateDepartmentRequestDto,
    manager: ManagerContext,
  ): Promise<DepartmentAdminDto> {
    if (req.name === undefined && req.is_active === undefined) {
      throw new BadRequestException("Nothing to update.");
    }

    let department: AdminDepartmentRow | null;
    try {
      department = await this.dbService.db.transaction(async (tx) => {
        // 같은 학교의 동시 비활성화를 직렬화해서 활성 학과가 0개가 되지 않게 함
        if (req.is_active === false) {
          await this.schoolRepository.findByPkForUpdate(schoolPk, tx);
        }
        const before = await this.departmentRepository.findByPkForUpdate(
          schoolPk,
          departmentPk,
          tx,
        );
        if (!before) {
          return null;
        }
        const updated = await this.departmentRepository.update(
          schoolPk,
          departmentPk,
          { name: req.name, isActive: req.is_active },
          tx,
        );
        if (
          updated &&
          req.is_active === false &&
          !(await this.departmentRepository.existsActiveBySchoolPk(
            schoolPk,
            tx,
          ))
        ) {
          // 활성 학과가 없으면 가입 중인 재학생이 프로필 단계를 끝낼 수 없음
          throw new ConflictException(
            "At least one active department is required.",
          );
        }
        if (updated) {
          await this.adminAuditLogRepository.insert(
            {
              adminEmail: manager.email,
              action: "school_department.update",
              targetType: "school_department",
              targetId: departmentPk,
              before: this.toDepartmentSnapshot(before),
              after: this.toDepartmentSnapshot(updated),
            },
            tx,
          );
        }
        return updated;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(DEPARTMENT_NAME_EXISTS, { cause: e });
      }
      throw e;
    }
    if (!department) {
      throw new NotFoundException("Department not found.");
    }
    return this.toDepartmentDto(department);
  }

  // 재학생의 학교는 이메일 도메인으로 정하므로 인증을 마친 학생이 있는 도메인을 빼면
  // 그 학생은 학과 목록이 비고 프로필을 저장할 수 없음. 그래서 뺄 수 없게 막음
  async replaceEmailDomains(
    schoolPk: number,
    req: ReplaceEmailDomainsRequestDto,
    manager: ManagerContext,
  ): Promise<SchoolDto> {
    const next = req.email_domains;
    try {
      return await this.dbService.db.transaction(async (tx) => {
        const school = await this.schoolRepository.findByPkForUpdate(
          schoolPk,
          tx,
        );
        if (!school) {
          throw new NotFoundException(SCHOOL_NOT_FOUND);
        }

        const rows = await this.schoolEmailDomainRepository.findBySchoolPk(
          schoolPk,
          tx,
        );
        const current = rows.map((row) => row.domain);
        const removed = current.filter((domain) => !next.includes(domain));
        const added = next.filter((domain) => !current.includes(domain));

        // 지운 뒤에 검사함. 진행 중인 인증 완료는 도메인 행을 FOR SHARE로 잡고 있어 DELETE가 그 커밋을
        // 기다리므로 그 학생이 아래 검사에 보이고, 이후의 인증 완료는 지워진 도메인을 보고 실패함.
        // 사용 중이면 예외로 rollback되어 지운 행이 되돌아감
        if (removed.length > 0) {
          await this.schoolEmailDomainRepository.deleteBySchoolPkAndDomains(
            schoolPk,
            removed,
            tx,
          );
        }
        for (const domain of removed) {
          if (await this.studentRepository.existsByEmailDomain(domain, tx)) {
            throw new ConflictException(
              `Email domain is in use by verified students: ${domain}`,
            );
          }
        }
        if (added.length > 0) {
          await this.schoolEmailDomainRepository.insertMany(
            schoolPk,
            added,
            tx,
          );
        }

        const saved = await this.schoolEmailDomainRepository.findBySchoolPk(
          schoolPk,
          tx,
        );
        const savedDomains = saved.map((row) => row.domain);
        // 바뀐 게 없으면 남기지 않음
        if (removed.length > 0 || added.length > 0) {
          await this.adminAuditLogRepository.insert(
            {
              adminEmail: manager.email,
              action: "school_email_domain.replace",
              targetType: "school_email_domain",
              targetId: schoolPk,
              before: { domains: current },
              after: { domains: savedDomains },
            },
            tx,
          );
        }
        return this.toSchoolDto(school, savedDomains);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          "Email domain is already used by another school.",
          { cause: e },
        );
      }
      throw e;
    }
  }

  private async findSchool(schoolPk: number): Promise<AdminSchoolRow> {
    const school = await this.schoolRepository.findByPk(schoolPk);
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND);
    }
    return school;
  }

  private toSchoolDto(school: AdminSchoolRow, domains: string[]): SchoolDto {
    return { pk: school.pk, name: school.name, email_domains: domains };
  }

  // 감사 로그용 스냅샷
  private toDepartmentSnapshot(
    department: AdminDepartmentRow,
  ): AdminAuditSnapshot {
    return {
      school_pk: department.schoolPk,
      name: department.name,
      is_active: department.isActive,
    };
  }

  private toDepartmentDto(department: AdminDepartmentRow): DepartmentAdminDto {
    return {
      pk: department.pk,
      school_pk: department.schoolPk,
      name: department.name,
      is_active: department.isActive,
    };
  }
}
