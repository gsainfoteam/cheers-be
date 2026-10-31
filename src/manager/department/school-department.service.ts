import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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

  async createDepartment(
    schoolPk: number,
    req: CreateDepartmentRequestDto,
  ): Promise<DepartmentAdminDto> {
    await this.findSchool(schoolPk);
    const department = await this.departmentRepository.insertIfAbsent(
      schoolPk,
      req.name,
    );
    if (!department) {
      throw new ConflictException(DEPARTMENT_NAME_EXISTS);
    }
    return this.toDepartmentDto(department);
  }

  // 행을 지우지 않으므로 이미 고른 학생의 프로필 · 조회는 그대로 유지됨
  async updateDepartment(
    schoolPk: number,
    departmentPk: number,
    req: UpdateDepartmentRequestDto,
  ): Promise<DepartmentAdminDto> {
    if (req.name === undefined && req.is_active === undefined) {
      throw new BadRequestException("Nothing to update.");
    }

    let department: AdminDepartmentRow | null;
    try {
      department = await this.departmentRepository.update(
        schoolPk,
        departmentPk,
        { name: req.name, isActive: req.is_active },
      );
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

        for (const domain of removed) {
          if (await this.studentRepository.existsByEmailDomain(domain, tx)) {
            throw new ConflictException(
              `Email domain is in use by verified students: ${domain}`,
            );
          }
        }
        if (removed.length > 0) {
          await this.schoolEmailDomainRepository.deleteBySchoolPkAndDomains(
            schoolPk,
            removed,
            tx,
          );
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
        return this.toSchoolDto(
          school,
          saved.map((row) => row.domain),
        );
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

  private toDepartmentDto(department: AdminDepartmentRow): DepartmentAdminDto {
    return {
      pk: department.pk,
      school_pk: department.schoolPk,
      name: department.name,
      is_active: department.isActive,
    };
  }
}
