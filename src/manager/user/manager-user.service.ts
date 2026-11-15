import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import {
  AdminUserListRow,
  AdminUserRepository,
  AdminUserRow,
} from "@src/admin-repository/admin-user.repository";
import { toOffset } from "@src/cheers/cheers.utils";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import { ManagerContext } from "@src/manager/context/manager-context";
import {
  UserContactDto,
  UserDetailDto,
  UserListItemDto,
  UserListQueryDto,
  UserWithdrawalState,
} from "@src/manager/user/dto/manager-user.dto";

@Injectable()
export class ManagerUserService {
  constructor(
    private readonly userRepository: AdminUserRepository,
    private readonly accessLogRepository: AdminAccessLogRepository,
  ) {}

  async listUsers(
    query: UserListQueryDto,
  ): Promise<PageResponseDto<UserListItemDto>> {
    const createdFrom = query.created_from
      ? new Date(query.created_from)
      : undefined;
    const createdTo = query.created_to ? new Date(query.created_to) : undefined;
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new BadRequestException(
        "created_from must not be after created_to",
      );
    }

    const { page, size } = query;
    const { rows, total } = await this.userRepository.findPage(
      {
        type: query.type,
        status: query.status,
        withdrawal: query.withdrawal === "all" ? undefined : query.withdrawal,
        keyword: query.q,
        createdFrom,
        createdTo,
      },
      toOffset(page, size),
      size,
    );
    return {
      items: rows.map((row) => this.toListItemDto(row)),
      page,
      size,
      total,
    };
  }

  async getUser(pk: string): Promise<UserDetailDto> {
    const user = await this.userRepository.findByPk(pk);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isStudent = user.type === "student";
    const [oauthAccounts, contact, consents, student, graduated] =
      await Promise.all([
        this.userRepository.findOauthAccounts(pk),
        this.userRepository.findContactFlags(pk),
        this.userRepository.findConsents(pk),
        isStudent ? this.userRepository.findStudentByUserPk(pk) : null,
        isStudent ? null : this.userRepository.findGraduatedByUserPk(pk),
      ]);

    return {
      pk: user.pk,
      name: user.name,
      email: user.email,
      type: user.type,
      status: user.status,
      withdrawal_state: this.toWithdrawalState(user),
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      last_active_at: user.lastActiveAt,
      withdraw_requested_at: user.withdrawRequestedAt,
      oauth_accounts: oauthAccounts.map((account) => ({
        provider: account.provider,
        email: account.email,
        created_at: account.createdAt,
        last_login_at: account.lastLoginAt,
      })),
      contact_methods: contact && {
        kakao_enabled: contact.kakaoEnabled,
        email_enabled: contact.emailEnabled,
      },
      consents: consents.map((consent) => ({
        type: consent.consentType,
        version: consent.consentVersion,
        agreed_at: consent.agreedAt,
        revoked_at: consent.revokedAt,
      })),
      student: student && {
        student_pk: student.studentPk,
        school_email: student.schoolEmail,
        verified_at: student.verifiedAt,
        school: student.school,
        department: student.department,
        interests: student.interests,
        activities: student.activities,
      },
      graduated: graduated && {
        graduated_pk: graduated.graduatedPk,
        verified_at: graduated.verifiedAt,
        has_business_card: graduated.hasBusinessCard,
        nickname: graduated.nickname,
        company: graduated.company,
        department: graduated.department,
        job: graduated.job,
        hashtags: graduated.hashtags,
        links: graduated.links,
      },
      coffee_chat_request_count:
        student?.requestCount ?? graduated?.requestCount ?? 0,
    };
  }

  // 열람 기록을 먼저 남김. 저장에 실패하면 예외가 그대로 올라가 값을 내려주지 않음.
  // 기록에는 연락처 값을 넣지 않고 누가 · 언제 · 누구 것을 봤는지만 남김
  async getContact(
    pk: string,
    manager: ManagerContext,
  ): Promise<UserContactDto> {
    const contact = await this.userRepository.findContactByUserPk(pk);
    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    await this.accessLogRepository.insert({
      adminEmail: manager.email,
      targetType: "user_contact",
      targetId: pk,
    });

    return {
      kakao_enabled: contact.kakaoEnabled,
      email_enabled: contact.emailEnabled,
      phone: contact.phone,
      email: contact.email,
    };
  }

  private toListItemDto(row: AdminUserListRow): UserListItemDto {
    return {
      pk: row.pk,
      name: row.name,
      email: row.email,
      type: row.type,
      status: row.status,
      withdrawal_state: this.toWithdrawalState(row),
      affiliation: {
        school: row.school,
        department: row.department,
        company: row.company,
        job: row.job,
      },
      created_at: row.createdAt,
      last_active_at: row.lastActiveAt,
    };
  }

  // is_deleted가 우선: 탈퇴가 끝난 뒤에도 withdraw_requested_at은 남아 있음
  private toWithdrawalState(
    user: Pick<AdminUserRow, "isDeleted" | "withdrawRequestedAt">,
  ): UserWithdrawalState {
    if (user.isDeleted) {
      return "deleted";
    }
    return user.withdrawRequestedAt ? "requested" : "none";
  }
}
