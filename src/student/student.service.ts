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
import { TxType } from "@src/global/types/tx.types";
import { FileDirectory, FilePurpose } from "@src/file/file.constants";
import { FileService } from "@src/file/file.service";
import { isUserTempFileKey } from "@src/file/file.utils";
import { DepartmentListResponseDto } from "./dto/departments.dto";
import {
  assertContactValues,
  ContactRequestDto,
  toContactRow,
} from "@src/user/dto/contact-request.dto";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { InterestListResponseDto } from "./dto/interests.dto";
import { InterestService } from "./interest.service";
import {
  SaveStudentInfoRequestDto,
  StudentAttachmentRequestDto,
} from "./dto/save-student-info.dto";
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
    private readonly fileService: FileService,
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

    const requests = req.attachments ?? [];
    const { newKeys, reusedKeys } = classifyFileKeys(userPk, requests);

    // S3 이동은 되돌리지 않으므로, 실패할 요청이면 옮기기 전에 잠금 없이 한 번 걸러냄 (트랜잭션 안에서 다시 검사)
    if (newKeys.length > 0) {
      await this.findCurrentForSave(userPk, req.department_id, reusedKeys);
    }

    // S3 확인 · 이동은 트랜잭션 밖에서 먼저 해서 DB 잠금을 오래 잡지 않음
    // 트랜잭션이 실패해도 확정한 새 파일은 지우지 않음: COMMIT 직후 연결이 끊겨 예외가 나면
    // DB는 커밋됐는데 파일만 지워지기 때문. 참조 없는 파일은 OrphanFileService가 정리
    const attachments = await this.toAttachmentValues(userPk, requests);
    const values: ProfileValues = {
      departmentPk: req.department_id,
      interests: req.interests,
      activities: req.activities ?? [],
      attachments,
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

      const current = await this.findCurrentForSave(
        userPk,
        values.departmentPk,
        reusedKeys,
        tx,
      );

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

  // 현재 프로필을 읽으면서 저장할 수 있는 요청인지 검사
  private async findCurrentForSave(
    userPk: string,
    departmentPk: number,
    reusedKeys: string[],
    tx?: TxType,
  ): Promise<StudentWithLatestProfile> {
    const current = await this.studentRepository.findByUserPkWithLatestProfile(
      userPk,
      tx,
    );
    if (!current) {
      throw new ForbiddenException("User type not allowed");
    }
    if (!current.student.email) {
      throw new NotFoundException("Verified student email not found");
    }

    const department = await this.departmentRepository.findByPkAndEmailDomain(
      departmentPk,
      emailDomain(current.student.email),
      tx,
    );
    if (!department) {
      throw new BadRequestException(
        "Department does not belong to your school",
      );
    }

    // 새로 올린 파일이 아닌 key는 내 현재 첨부의 파일이어야 함 (남의 파일 · 임의 key 거부)
    const currentFileKeys = new Set(
      (current.latest?.attachments ?? [])
        .filter((a) => a.source === "file")
        .map((a) => a.url),
    );
    if (reusedKeys.some((key) => !currentFileKeys.has(key))) {
      throw new BadRequestException("Invalid file key");
    }
    return current;
  }

  // 첨부를 저장 값으로 바꿈. 새로 올린 파일은 confirmUpload로 확정한 최종 key, 기존 파일은 key 그대로
  private async toAttachmentValues(
    userPk: string,
    requests: StudentAttachmentRequestDto[],
  ): Promise<StudentAttachment[]> {
    const attachments: StudentAttachment[] = [];
    for (const a of requests) {
      if (a.source === "link") {
        attachments.push({
          kind: a.kind,
          source: "link",
          url: a.url as string,
          fileName: null,
        });
        continue;
      }
      const key = a.key as string;
      attachments.push({
        kind: a.kind,
        source: "file",
        url: isUserTempFileKey(FileDirectory.ATTACHMENT, userPk, key)
          ? await this.fileService.confirmUpload(
              userPk,
              FilePurpose.ATTACHMENT,
              key,
            )
          : key,
        fileName: a.file_name as string,
      });
    }
    return attachments;
  }
}

// S3 · DB를 부르기 전에 첨부 형식을 검사하고 file key를 둘로 나눔
// - 새로 올린 파일: tmp/attachment/<내 userPk>/...
// - 기존 파일 유지: attachment/<내 userPk>/... (내 현재 첨부인지는 findCurrentForSave에서 검사)
// 내 정보 조회 응답을 그대로 보낼 수 있게 null은 없는 값으로 보고, 파일의 url(presigned)은 무시함
const classifyFileKeys = (
  userPk: string,
  requests: StudentAttachmentRequestDto[],
): { newKeys: string[]; reusedKeys: string[] } => {
  const finalPrefix = `${FileDirectory.ATTACHMENT}/${userPk}/`;
  const newKeys: string[] = [];
  const reusedKeys: string[] = [];
  for (const a of requests) {
    if (a.source === "link") {
      if ((a.key ?? a.file_name ?? null) !== null) {
        throw new BadRequestException("Link attachment cannot have a file");
      }
      continue;
    }
    const key = a.key as string;
    if (newKeys.includes(key) || reusedKeys.includes(key)) {
      throw new BadRequestException("Duplicate file key");
    }
    if (isUserTempFileKey(FileDirectory.ATTACHMENT, userPk, key)) {
      newKeys.push(key);
    } else if (key.startsWith(finalPrefix)) {
      reusedKeys.push(key);
    } else {
      throw new BadRequestException("Invalid file key");
    }
  }
  return { newKeys, reusedKeys };
};

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
