import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { DepartmentRepository } from "@src/database/repository/department.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
import {
  StudentAttachment,
  StudentRepository,
  StudentWithLatestProfile,
} from "@src/database/repository/student.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { DepartmentListResponseDto } from "./dto/departments.dto";
import {
  assertContactValues,
  ContactRequestDto,
  toContactRow,
} from "@src/user/dto/contact-request.dto";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { InterestListResponseDto } from "./dto/interests.dto";
import { InterestService } from "./interest.service";
import { SaveStudentInfoRequestDto } from "./dto/save-student-info.dto";
import { emailDomain } from "./student.utils";

type ProfileValues = {
  departmentPk: number;
  interests: string[];
  activities: string[];
  attachments: StudentAttachment[];
};

// 재학생 학과 목록 · 추가 정보 저장 (가입 단계 profile + 마이페이지 수정)
@Injectable()
export class StudentService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly authService: AuthService,
    private readonly userRepository: UserRepository,
    private readonly studentRepository: StudentRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly studentProfileRepository: StudentProfileRepository,
    private readonly studentProfileAttachmentRepository: StudentProfileAttachmentRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
    private readonly interestService: InterestService,
  ) {}

  async getDepartments(userPk: string): Promise<DepartmentListResponseDto> {
    const student = await this.studentRepository.findByUserPk(userPk);
    // 가드 통과 뒤 다른 기기에서 현업자로 유형을 바꾸면 재학생 행이 없음 (현업자 API와 같은 403)
    if (!student) {
      throw new ForbiddenException("User type not allowed");
    }
    // profile 단계 이후라 인증한 이메일이 항상 있음
    if (!student.email) {
      throw new NotFoundException("Verified student email not found");
    }

    const departments = await this.departmentRepository.findByEmailDomain(
      emailDomain(student.email),
    );
    return {
      departments: departments.map((d) => ({ id: d.pk, name: d.name })),
    };
  }

  getInterests(): InterestListResponseDto {
    return { interests: this.interestService.getNames() };
  }

  // 보낸 값으로 전체 교체. 학과 · 관심 분야 · 참여 활동 · 첨부가 바뀌었을 때만 새 버전
  async saveInfo(
    userPk: string,
    req: SaveStudentInfoRequestDto,
  ): Promise<SignupCompleteResponseDto> {
    validateContact(req.contact);

    const values: ProfileValues = {
      departmentPk: req.department_id,
      interests: req.interests,
      activities: req.activities ?? [],
      attachments: (req.attachments ?? []).map((a) => ({
        kind: a.kind,
        source: a.source,
        url: a.url,
        fileName: null,
      })),
    };

    const tokens = await this.dbService.db.transaction(async (tx) => {
      // 같은 유저의 동시 저장을 직렬화해서 같은 version을 두 번 넣지 않게 하고,
      // 가입 완료 여부도 잠근 행 기준으로 판단
      const user = await this.userRepository.findByPkForUpdate(userPk, tx);
      if (!user) {
        throw new UnauthorizedException("User not found");
      }
      if (!user.name && !req.name) {
        throw new BadRequestException("Name is required");
      }

      const current =
        await this.studentRepository.findByUserPkWithLatestProfile(userPk, tx);
      if (!current) {
        throw new ForbiddenException("User type not allowed");
      }
      if (!current.student.email) {
        throw new NotFoundException("Verified student email not found");
      }

      const department = await this.departmentRepository.findByPkAndEmailDomain(
        values.departmentPk,
        emailDomain(current.student.email),
        tx,
      );
      if (!department) {
        throw new BadRequestException(
          "Department does not belong to your school",
        );
      }

      // 이전 버전은 커피챗 요청이 참조하므로 수정 · 삭제하지 않음
      if (isProfileChanged(current.latest, values)) {
        const profile = await this.studentProfileRepository.insert(
          {
            studentPk: current.student.pk,
            version: (current.latest?.profile.version ?? 0) + 1,
            departmentPk: values.departmentPk,
            interests: values.interests,
            activities: values.activities,
          },
          tx,
        );
        await this.studentProfileAttachmentRepository.insertMany(
          profile.pk,
          values.attachments,
          tx,
        );
      }

      // 연락 설정은 버전 관리하지 않음. 끈 방법의 email / phone은 저장하지 않음 (null)
      await this.coffeeChatContactRepository.upsert(
        toContactRow(userPk, req.contact),
        tx,
      );

      // 한 번 저장한 이름은 수정 불가라 비어 있을 때만 채움
      if (!user.name && req.name) {
        await this.userRepository.fillName(userPk, req.name, tx);
      }

      if (user.status !== "pending") return null;

      // 가입 완료. 기존 refresh token은 갱신 때 DB의 status로 클레임을 다시 만들므로 그대로 둠
      await this.userRepository.activate(userPk, tx);
      return this.authService.issueTokens({ ...user, status: "active" }, tx);
    });

    if (!tokens) return { result: "OK" };
    return {
      result: "OK",
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }
}

// 재학생은 "희망하지 않음"(둘 다 false)을 고를 수 없음. 고른 방법의 값 검사는 공용
const validateContact = (contact: ContactRequestDto): void => {
  if (!contact.email_enabled && !contact.kakao_enabled) {
    throw new BadRequestException("At least one contact method is required");
  }
  assertContactValues(contact);
};

// 순서까지 같아야 같은 값. activities가 null인 이전 버전은 빈 배열로 봄
const isProfileChanged = (
  latest: StudentWithLatestProfile["latest"],
  values: ProfileValues,
): boolean => {
  if (!latest) return true;

  return (
    latest.profile.departmentPk !== values.departmentPk ||
    !arrayEquals(latest.profile.interests, values.interests) ||
    !arrayEquals(latest.profile.activities ?? [], values.activities) ||
    latest.attachments.length !== values.attachments.length ||
    latest.attachments.some((a, i) => {
      const b = values.attachments[i];
      return (
        a.kind !== b.kind ||
        a.source !== b.source ||
        a.url !== b.url ||
        a.fileName !== b.fileName
      );
    })
  );
};

const arrayEquals = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
