import {
  ConflictException,
  Injectable,
  Logger,
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
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
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
  private readonly logger = new Logger(UserService.name);

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

        await this.userOauthAccountRepository.updateLastLogin(
          profile.provider,
          profile.sub,
          profile.email,
          tx,
        );
        await this.userRepository.fillProfileFromOAuth(
          existing.pk,
          { name: profile.name, email: profile.email },
          tx,
        );

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
      await this.deleteFileQuietly(businessCardKey);
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
    // 토큰 클레임은 유형 변경 · 가입 완료 전 값일 수 있어 DB 기준으로 응답
    const user = await this.userRepository.findByPk(userCtx.userPk);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const [progress, contact] = await Promise.all([
      this.userRepository.findSignupProgress(user.pk, user.type),
      this.coffeeChatContactRepository.findByUserPk(user.pk),
    ]);
    const contactDto = contact ? this.toContactDto(contact) : null;

    const [student, graduated] = await Promise.all([
      user.type === "student" ? this.getStudentInfo(user.pk, contactDto) : null,
      user.type === "graduated"
        ? this.getGraduatedInfo(user.pk, contactDto)
        : null,
    ]);
    await this.authService.touchLastActive(user.pk);

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

  // 회원 탈퇴 (가입 중인 pending 유저도 가능).
  // 지움: OAuth 계정, refresh token, 연락 설정(coffee_chat_contact), 명함 S3 파일 + key,
  //       users.name / email, student.email (같은 학교 이메일로 재가입 가능하도록)
  // 남김: 약관 동의 이력, student / graduated 행, 재학생 프로필 버전과 첨부(링크), 현업자 프로필(닉네임 · 회사 · 부서 · 직무 · 해시태그 · 링크),
  //       커피챗 요청(공유된 연락처 shared_phone / shared_email 포함)과 알림 로그 — 상대방의 커피챗 기록이 참조함.
  //       첨부 파일 업로드가 생기면(CRB-18) S3 파일 처리를 함께 정할 것
  // 유저 행을 먼저 잠가서 다른 기기의 동시 로그인이 탈퇴 뒤에 토큰을 새로 만들지 않게 함
  async withdraw(userCtx: UserContext): Promise<BaseResultDto> {
    const businessCardKey = await this.dbService.db.transaction(async (tx) => {
      const user = await this.userRepository.findByPkForUpdate(
        userCtx.userPk,
        tx,
      );
      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      await this.userOauthAccountRepository.deleteByUserPk(user.pk, tx);
      await this.authService.revokeAllTokens(user.pk, tx);
      await this.coffeeChatContactRepository.deleteByUserPk(user.pk, tx);
      let key: string | null = null;
      if (user.type === "student") {
        await this.studentRepository.clearEmailByUserPk(user.pk, tx);
      } else {
        const graduated = await this.graduatedRepository.findByUserPk(
          user.pk,
          tx,
        );
        if (graduated?.businessCardKey) {
          await this.graduatedRepository.clearBusinessCardKey(graduated.pk, tx);
          key = graduated.businessCardKey;
        }
      }
      await this.userRepository.withdraw(user.pk, tx);
      return key;
    });

    if (businessCardKey) {
      await this.deleteFileQuietly(businessCardKey);
    }
    return BaseResultDto.OK;
  }

  // 최초 로그인: users(pending) + user_oauth_account + student / graduated
  private async signup(
    profile: OAuthProfile,
    type: UserType,
    tx: TxType,
  ): Promise<UserRow> {
    const user = await this.userRepository.insert(
      { type, name: profile.name, email: profile.email },
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

  // FK cascade가 없으므로 자식부터 삭제.
  // 커피챗 요청은 가입을 마친(active) 재학생만 만들 수 있어 가입 중 유형 변경에서는 없음
  private async deleteStudent(userPk: string, tx: TxType): Promise<void> {
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
  private async deleteGraduated(
    userPk: string,
    tx: TxType,
  ): Promise<string | null> {
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

  private async getStudentInfo(
    userPk: string,
    contact: ContactDto | null,
  ): Promise<StudentInfoDto | null> {
    const student = await this.studentRepository.findByUserPk(userPk);
    if (!student) return null;

    const latest = await this.studentProfileRepository.findLatestByStudentPk(
      student.pk,
    );
    const attachments = latest
      ? await this.studentProfileAttachmentRepository.findByProfilePk(
          latest.profile.pk,
        )
      : [];

    const profile = latest
      ? {
          department: {
            id: latest.department.pk,
            name: latest.department.name,
          },
          interests: latest.profile.interests,
          activities: latest.profile.activities ?? [],
          attachments: await Promise.all(
            attachments.map(async (attachment) => ({
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
        }
      : null;

    return {
      email: student.email,
      verified: student.verifiedAt !== null,
      profile,
    };
  }

  private async getGraduatedInfo(
    userPk: string,
    contact: ContactDto | null,
  ): Promise<GraduatedInfoDto | null> {
    const graduated = await this.graduatedRepository.findByUserPk(userPk);
    if (!graduated) return null;

    const profile = await this.graduatedProfileRepository.findByGraduatedPk(
      graduated.pk,
    );
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

  private async deleteFileQuietly(key: string): Promise<void> {
    try {
      await this.fileService.deleteFile(key);
    } catch (e) {
      this.logger.error(
        `Failed to delete file ${key}: ${(e as Error).message}`,
      );
    }
  }
}
