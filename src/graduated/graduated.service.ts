import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import {
  normalizeCompanyName,
  toCompanyDisplayName,
} from "@src/company/company.utils";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import {
  CompanyAliasRow,
  CompanyRepository,
} from "@src/database/repository/company.repository";
import { GraduatedProfileRepository } from "@src/database/repository/graduated-profile.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { FilePurpose } from "@src/file/file.constants";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import {
  assertContactValues,
  toContactRow,
} from "@src/user/dto/contact-request.dto";
import { TxType } from "@src/global/types/tx.types";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { GraduatedInfoRequestDto } from "./dto/graduated-info.dto";

@Injectable()
export class GraduatedService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly authService: AuthService,
    private readonly fileService: FileService,
    private readonly userRepository: UserRepository,
    private readonly graduatedRepository: GraduatedRepository,
    private readonly graduatedProfileRepository: GraduatedProfileRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
    private readonly companyRepository: CompanyRepository,
  ) {}

  // 명함 등록 = 즉시 인증. 다시 등록하면 이전 명함을 대체
  async verifyBusinessCard(
    userPk: string,
    tempKey: string,
  ): Promise<BaseResultDto> {
    // S3 확인 · 이동은 트랜잭션 밖에서 먼저 해서 DB 잠금을 오래 잡지 않음
    // 트랜잭션이 실패해도 확정한 새 파일은 지우지 않음: COMMIT 직후 연결이 끊겨 예외가 나면
    // DB는 커밋됐는데 파일만 지워지기 때문. 참조 없는 파일은 OrphanFileService가 정리
    const key = await this.fileService.confirmUpload(
      userPk,
      FilePurpose.BUSINESS_CARD,
      tempKey,
    );

    const previousKey = await this.dbService.db.transaction(async (tx) => {
      // 같은 유저의 로그인(유형 변경) · 탈퇴 요청 · 동시 등록과 직렬화
      const user = await this.userRepository.findByPkForUpdate(userPk, tx);
      if (!user) {
        throw new UnauthorizedException("User not found");
      }
      const graduated = await this.graduatedRepository.findByUserPk(userPk, tx);
      if (!graduated) {
        // 가드 통과 직후 다른 기기에서 재학생으로 유형 변경
        throw new ForbiddenException("User type not allowed");
      }

      await this.graduatedRepository.updateBusinessCard(graduated.pk, key, tx);
      return graduated.businessCardKey;
    });

    // 커밋 뒤에 지움. 실패해도 DB는 새 key를 가리키므로 로그만 남김
    if (previousKey && previousKey !== key) {
      await this.fileService.deleteFileQuietly(previousKey);
    }
    return BaseResultDto.OK;
  }

  // 추가 정보 저장 · 수정 (전체 교체). 가입 중이면 가입 완료 + 토큰 재발급
  async saveInfo(
    userPk: string,
    req: GraduatedInfoRequestDto,
  ): Promise<SignupCompleteResponseDto> {
    // 현업자는 "희망하지 않음"(둘 다 false) 가능
    assertContactValues(req.contact);
    if ((req.company_id === undefined) === (req.company_name === undefined)) {
      throw new BadRequestException(
        "Exactly one of company_id, company_name is required",
      );
    }

    const tokens = await this.dbService.db.transaction(async (tx) => {
      // 같은 유저의 동시 저장 · 로그인(유형 변경)과 직렬화하고, 가입 완료 여부를 잠근 행 기준으로 판단
      const user = await this.userRepository.findByPkForUpdate(userPk, tx);
      if (!user) {
        throw new UnauthorizedException("User not found");
      }
      if (!user.name && !req.name) {
        throw new BadRequestException("Name is required");
      }

      const found = await this.graduatedRepository.findByUserPkWithProfile(
        userPk,
        tx,
      );
      if (!found) {
        throw new ForbiddenException("User type not allowed");
      }
      // nickname은 첫 저장에만 쓰고 이후에는 upsert가 갱신하지 않음
      const nickname = found.profile?.nickname ?? req.nickname;
      if (!nickname) {
        throw new BadRequestException("Nickname is required");
      }

      const company = await this.resolveCompany(req, tx);
      await this.graduatedProfileRepository.upsert(
        {
          graduatedPk: found.graduated.pk,
          nickname,
          companyAliasPk: company.pk,
          department: req.department ?? null,
          job: req.job,
          hashtags: req.hashtags ?? [],
          links: req.links ?? [],
        },
        tx,
      );
      await this.coffeeChatContactRepository.upsert(
        toContactRow(userPk, req.contact),
        tx,
      );
      if (!user.name && req.name) {
        await this.userRepository.fillName(userPk, req.name, tx);
      }

      if (user.status === "active") return null;
      await this.userRepository.activate(userPk, tx);
      // 기존 refresh token은 폐기하지 않음 (갱신 때 DB의 status로 클레임을 다시 만듦)
      return this.authService.issueTokens({ ...user, status: "active" }, tx);
    });

    if (!tokens) return BaseResultDto.OK;
    return {
      result: BaseResultDto.OK.result,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  // 프로필이 가리킬 회사. 검색 결과에서 골랐으면 그 회사, 직접 입력했으면 같은 표기의 회사 또는 새 회사(어드민 검토 대기)
  private async resolveCompany(
    req: GraduatedInfoRequestDto,
    tx: TxType,
  ): Promise<CompanyAliasRow> {
    if (req.company_id !== undefined) {
      // 어드민의 병합 · 삭제와 직렬화. 검색 뒤 병합되어 사라졌으면 다시 검색해야 함
      const alias = await this.companyRepository.findByPkForKeyShare(
        req.company_id,
        tx,
      );
      if (!alias) {
        throw new NotFoundException("Company not found");
      }
      return alias;
    }

    const name = toCompanyDisplayName(req.company_name!);
    const normalized = normalizeCompanyName(name);
    await this.companyRepository.lockName(normalized, tx);
    // 등록된 표기면 검색 결과를 고르지 않았어도 그 회사로 (예: "마이크로소프트" → Microsoft)
    const existing =
      await this.companyRepository.findByNormalizedNameForKeyShare(
        normalized,
        tx,
      );
    return (
      existing ??
      (await this.companyRepository.createPending(name, normalized, tx))
    );
  }
}
