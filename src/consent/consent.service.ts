import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { ConsentRepository } from "./consent.repository";
import { ConsentListResponseDto } from "./dto/consent-list.dto";
import { UpdateConsentRequestDto } from "./dto/update-consent.dto";

@Injectable()
export class ConsentService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly consentRepository: ConsentRepository,
  ) {}

  async getList(userPk: string): Promise<ConsentListResponseDto> {
    const consents =
      await this.consentRepository.findLatestWithAgreement(userPk);

    return {
      consents: consents.map((c) => ({
        type: c.type,
        version: c.version,
        is_required: c.isRequired,
        url: c.url,
        agreed: c.agreed,
      })),
    };
  }

  // 가입 시 동의, 개정 약관 재동의, 선택 약관 동의 · 철회.
  // 요청에 없는 선택 약관은 그대로 두고, 필수 약관은 최신 버전을 모두 agreed: true로 보내야 함
  async updateConsents(
    userPk: string,
    req: UpdateConsentRequestDto,
  ): Promise<BaseResultDto> {
    const types = req.consents.map((c) => c.type);
    if (new Set(types).size !== types.length) {
      throw new BadRequestException("Duplicate consent type");
    }

    await this.dbService.db.transaction(async (tx) => {
      const latest = new Map(
        (await this.consentRepository.findLatestWithAgreement(userPk, tx)).map(
          (c) => [c.type, c],
        ),
      );

      for (const c of req.consents) {
        if (latest.get(c.type)?.version !== c.version) {
          throw new BadRequestException(
            `Not the latest consent version: ${c.type} ${c.version}`,
          );
        }
      }

      const agreedTypes = new Set(
        req.consents.filter((c) => c.agreed).map((c) => c.type),
      );
      const missingRequired = [...latest.values()].filter(
        (c) => c.isRequired && !agreedTypes.has(c.type),
      );
      if (missingRequired.length > 0) {
        throw new BadRequestException(
          `Required consents must be agreed: ${missingRequired.map((c) => c.type).join(", ")}`,
        );
      }

      await this.consentRepository.insertAgreements(
        userPk,
        req.consents.filter((c) => c.agreed),
        tx,
      );
      // 위 검사로 agreed: false는 선택 약관만 남음
      await this.consentRepository.revokeByTypes(
        userPk,
        req.consents.filter((c) => !c.agreed).map((c) => c.type),
        tx,
      );
    });

    return BaseResultDto.OK;
  }

  // 내 정보의 consent_required: 새로 개정된 필수 약관에 다시 동의해야 하면 true
  async isConsentRequired(userPk: string, tx?: TxType): Promise<boolean> {
    return this.consentRepository.hasMissingRequiredConsent(userPk, tx);
  }
}
