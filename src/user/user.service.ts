import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { UserStatus, UserType } from "@src/auth/auth.types";
import { UserContext } from "@src/auth/context/user-context";
import { calculateNextStep } from "@src/auth/signup-step";
import { DatabaseService } from "@src/database/database.service";
import {
  CoffeeChatContactRepository,
  CoffeeChatContactRow,
} from "@src/database/repository/coffee-chat-contact.repository";
import { GraduatedProfileRepository } from "@src/database/repository/graduated-profile.repository";
import {
  GraduatedRepository,
  GraduatedWithProfile,
} from "@src/database/repository/graduated.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
import {
  StudentRepository,
  StudentWithLatestProfile,
} from "@src/database/repository/student.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import {
  SignupProgress,
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { LoginRequestDto, LoginResponseDto } from "@src/user/dto/login.dto";
import { LogoutRequestDto } from "@src/user/dto/logout.dto";
import {
  RefreshRequestDto,
  RefreshResponseDto,
} from "@src/user/dto/refresh.dto";
import {
  ContactDto,
  GraduatedInfoDto,
  StudentInfoDto,
  UserInfoDto,
} from "@src/user/dto/user-info.dto";
import { OAuthService } from "@src/user/oauth/oauth.service";
import { OAuthProfile } from "@src/user/oauth/oauth.types";

@Injectable()
export class UserService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
    private readonly fileService: FileService,
    private readonly userRepository: UserRepository,
    private readonly userOauthAccountRepository: UserOauthAccountRepository,
    private readonly studentRepository: StudentRepository,
    private readonly studentProfileRepository: StudentProfileRepository,
    private readonly studentProfileAttachmentRepository: StudentProfileAttachmentRepository,
    private readonly studentEmailVerificationRepository: StudentEmailVerificationRepository,
    private readonly graduatedRepository: GraduatedRepository,
    private readonly graduatedProfileRepository: GraduatedProfileRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
  ) {}

  async login(req: LoginRequestDto): Promise<LoginResponseDto> {
    const profile = await this.oauthService.verify(
      req.provider,
      req.token,
      req.nonce,
    );

    const { tokens, businessCardKey } = await this.dbService.db.transaction(
      async (tx) => {
        const existing = await this.userOauthAccountRepository.findUserForLogin(
          profile.provider,
          profile.sub,
          tx,
        );
        if (!existing) {
          const user = await this.signup(profile, req.type, tx);
          return {
            tokens: await this.authService.issueTokens(user, tx),
            businessCardKey: null,
          };
        }

        // 탈퇴 유예기간 중 다시 로그인하면 탈퇴 취소
        if (existing.withdrawRequestedAt) {
          await this.userRepository.cancelWithdrawal(existing.pk, tx);
        }
        await this.userOauthAccountRepository.updateLastLogin(
          profile.provider,
          profile.sub,
          profile.email,
          tx,
        );
        if (profile.email) {
          await this.userRepository.fillEmail(existing.pk, profile.email, tx);
        }

        // active: type 무시 / pending + 같은 type: 이어서 진행
        if (existing.status === "active" || existing.type === req.type) {
          return {
            tokens: await this.authService.issueTokens(existing, tx),
            businessCardKey: null,
          };
        }

        // pending + 다른 type: 인증 · 추가 정보를 지우고 새 유형으로 다시 시작. 약관 동의는 유지
        const removedKey = await this.changeType(existing, req.type, tx);
        return {
          tokens: await this.authService.issueTokens(
            { ...existing, type: req.type },
            tx,
          ),
          businessCardKey: removedKey,
        };
      },
    );

    // DB 정리가 끝난 뒤에 지움. 실패해도 DB에는 참조가 없으므로 로그만 남김
    if (businessCardKey) {
      await this.fileService.deleteFileQuietly(businessCardKey);
    }

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  async refresh(req: RefreshRequestDto): Promise<RefreshResponseDto> {
    const tokens = await this.authService.refresh(req.refresh_token);
    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  async getInfo(userCtx: UserContext): Promise<UserInfoDto> {
    // 유형이 필요한 조회는 토큰 클레임의 type으로 유저 조회와 동시에 보냄.
    // 클레임은 가입 중 유형 변경 전 값일 수 있으므로 응답은 DB의 type · status 기준
    const [user, contact, claimTyped] = await Promise.all([
      this.userRepository.findByPk(userCtx.userPk),
      this.coffeeChatContactRepository.findByUserPk(userCtx.userPk),
      this.findTypeDependentInfo(userCtx.userPk, userCtx.type),
      this.authService.touchLastActive(userCtx.userPk),
    ]);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    // 다른 기기에서 유형을 바꾼 뒤 남은 access token이면 DB type으로 다시 조회
    const { progress, studentInfo, graduatedInfo } =
      user.type === userCtx.type
        ? claimTyped
        : await this.findTypeDependentInfo(user.pk, user.type);
    const contactDto = contact ? this.toContactDto(contact) : null;

    const student = studentInfo
      ? await this.toStudentInfoDto(studentInfo, contactDto)
      : null;
    const graduated = graduatedInfo
      ? this.toGraduatedInfoDto(graduatedInfo, contactDto)
      : null;

    return {
      id: user.pk,
      type: user.type,
      status: user.status,
      next_step: calculateNextStep(user.status, progress),
      name: user.name,
      email: user.email,
      consent_required: this.isConsentRequired(user.status, progress),
      student,
      graduated,
    };
  }

  async logout(
    req: LogoutRequestDto,
    userCtx: UserContext,
  ): Promise<BaseResultDto> {
    await this.authService.logout(req.refresh_token, userCtx.userPk);
    return BaseResultDto.OK;
  }

  // 최초 로그인: users(pending) + user_oauth_account + student / graduated
  private async signup(
    profile: OAuthProfile,
    type: UserType,
    tx: TxType,
  ): Promise<UserRow> {
    const user = await this.userRepository.insert(
      { type, email: profile.email },
      tx,
    );
    const account = await this.userOauthAccountRepository.insert(
      {
        provider: profile.provider,
        providerSub: profile.sub,
        userPk: user.pk,
        email: profile.email,
      },
      tx,
    );
    if (!account) {
      // 같은 계정으로 동시에 최초 로그인. 이 트랜잭션은 롤백되고 다시 로그인하면 기존 유저로 들어감
      throw new ConflictException("Login already in progress");
    }
    await this.insertTypeRow(user.pk, type, tx);
    return user;
  }

  // 반환값: 지운 명함의 S3 key (커밋 후 삭제)
  private async changeType(
    user: UserRow,
    type: UserType,
    tx: TxType,
  ): Promise<string | null> {
    let businessCardKey: string | null = null;
    if (user.type === "student") {
      await this.deleteStudent(user.pk, tx);
    } else {
      businessCardKey = await this.deleteGraduated(user.pk, tx);
    }
    await this.userRepository.updateType(user.pk, type, tx);
    await this.insertTypeRow(user.pk, type, tx);
    // 다른 기기의 refresh token은 이전 유형으로 발급된 것이라 폐기
    await this.authService.revokeAllTokens(user.pk, tx);
    return businessCardKey;
  }

  // FK cascade가 없으므로 자식부터 삭제 (가입 미완료 계정 정리 CleanupService도 사용).
  // 커피챗 요청은 가입을 마친(active) 재학생만 만들 수 있어 가입 중에는 없음
  async deleteStudent(userPk: string, tx: TxType): Promise<void> {
    const student = await this.studentRepository.findByUserPk(userPk, tx);
    if (!student) return;

    await this.studentEmailVerificationRepository.deleteByStudentPk(
      student.pk,
      tx,
    );
    await this.studentProfileAttachmentRepository.deleteByStudentPk(
      student.pk,
      tx,
    );
    await this.studentProfileRepository.deleteByStudentPk(student.pk, tx);
    await this.studentRepository.deleteByPk(student.pk, tx);
  }

  // 반환값: 지운 명함의 S3 key. 커피챗 요청은 active 현업자만 받을 수 있어 여기서는 없음
  async deleteGraduated(userPk: string, tx: TxType): Promise<string | null> {
    const graduated = await this.graduatedRepository.findByUserPk(userPk, tx);
    if (!graduated) return null;

    await this.graduatedProfileRepository.deleteByGraduatedPk(graduated.pk, tx);
    await this.graduatedRepository.deleteByPk(graduated.pk, tx);
    return graduated.businessCardKey;
  }

  private async insertTypeRow(
    userPk: string,
    type: UserType,
    tx: TxType,
  ): Promise<void> {
    if (type === "student") {
      await this.studentRepository.insert(userPk, tx);
    } else {
      await this.graduatedRepository.insert(userPk, tx);
    }
  }

  // 가입을 마친 유저에게 개정된 필수 약관 재동의를 요구할 때 true. 가입 중이면 next_step = consent로 안내.
  // CRB-12가 약관 판정 함수를 만들면 여기만 바꾸면 됨
  private isConsentRequired(
    status: UserStatus,
    progress: SignupProgress,
  ): boolean {
    return status === "active" && progress.hasMissingRequiredConsent;
  }

  // 가입 진행 상황과 유형별 정보는 type에 따라 조회 대상이 달라 함께 묶음
  private async findTypeDependentInfo(
    userPk: string,
    type: UserType,
  ): Promise<{
    progress: SignupProgress;
    studentInfo: StudentWithLatestProfile | null;
    graduatedInfo: GraduatedWithProfile | null;
  }> {
    const [progress, studentInfo, graduatedInfo] = await Promise.all([
      this.userRepository.findSignupProgress(userPk, type),
      type === "student"
        ? this.studentRepository.findByUserPkWithLatestProfile(userPk)
        : null,
      type === "graduated"
        ? this.graduatedRepository.findByUserPkWithProfile(userPk)
        : null,
    ]);
    return { progress, studentInfo, graduatedInfo };
  }

  private async toStudentInfoDto(
    { student, latest }: StudentWithLatestProfile,
    contact: ContactDto | null,
  ): Promise<StudentInfoDto> {
    if (!latest) {
      return {
        email: student.email,
        verified: student.verifiedAt !== null,
        profile: null,
      };
    }

    return {
      email: student.email,
      verified: student.verifiedAt !== null,
      profile: {
        department: {
          id: latest.department.pk,
          name: latest.department.name,
        },
        interests: latest.profile.interests,
        activities: latest.profile.activities ?? [],
        attachments: await Promise.all(
          latest.attachments.map(async (attachment) => ({
            kind: attachment.kind,
            source: attachment.source,
            // file이면 비공개 버킷의 key라 presigned URL로 내려줌
            url:
              attachment.source === "file"
                ? await this.fileService.getPresignedUrl(attachment.url)
                : attachment.url,
            file_name: attachment.fileName,
          })),
        ),
        contact,
      },
    };
  }

  private toGraduatedInfoDto(
    { graduated, profile }: GraduatedWithProfile,
    contact: ContactDto | null,
  ): GraduatedInfoDto {
    return {
      verified: graduated.verifiedAt !== null,
      profile: profile
        ? {
            nickname: profile.nickname,
            company: profile.company,
            department: profile.department,
            job: profile.job,
            hashtags: profile.hashtags ?? [],
            links: profile.links ?? [],
            contact,
          }
        : null,
    };
  }

  private toContactDto(contact: CoffeeChatContactRow): ContactDto {
    return {
      email_enabled: contact.emailEnabled,
      kakao_enabled: contact.kakaoEnabled,
      email: contact.email,
      phone: contact.phone,
    };
  }
}
