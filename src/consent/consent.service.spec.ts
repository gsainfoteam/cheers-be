import { BadRequestException } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { ConsentRepository, LatestConsent } from "./consent.repository";
import { ConsentService } from "./consent.service";
import { ConsentAgreementDto } from "./dto/update-consent.dto";

const userPk = "8f1d2c3b-0000-4000-8000-000000000001";

const latest: LatestConsent[] = [
  {
    type: "marketing",
    version: "1.0",
    isRequired: false,
    url: "https://example.com/marketing/1.0",
    agreed: true,
  },
  {
    type: "privacy_policy",
    version: "1.0",
    isRequired: true,
    url: "https://example.com/privacy/1.0",
    agreed: false,
  },
  {
    type: "terms_of_service",
    version: "2.0",
    isRequired: true,
    url: "https://example.com/tos/2.0",
    agreed: false,
  },
];

const agree = (type: string, version: string, agreed = true) => ({
  type,
  version,
  agreed,
});

const requiredAgreed: ConsentAgreementDto[] = [
  agree("privacy_policy", "1.0"),
  agree("terms_of_service", "2.0"),
];

describe("ConsentService", () => {
  const tx = {} as TxType;
  const consentRepository = {
    findLatestWithAgreement: jest.fn(),
    insertAgreements: jest.fn(),
    revokeByTypes: jest.fn(),
  };
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const service = new ConsentService(
    dbService as unknown as DatabaseService,
    consentRepository as unknown as ConsentRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    consentRepository.findLatestWithAgreement.mockResolvedValue(latest);
  });

  it("getList maps the latest consents to the response", async () => {
    await expect(service.getList(userPk)).resolves.toEqual({
      consents: [
        {
          type: "marketing",
          version: "1.0",
          is_required: false,
          url: "https://example.com/marketing/1.0",
          agreed: true,
        },
        {
          type: "privacy_policy",
          version: "1.0",
          is_required: true,
          url: "https://example.com/privacy/1.0",
          agreed: false,
        },
        {
          type: "terms_of_service",
          version: "2.0",
          is_required: true,
          url: "https://example.com/tos/2.0",
          agreed: false,
        },
      ],
    });
    expect(consentRepository.findLatestWithAgreement).toHaveBeenCalledWith(
      userPk,
    );
  });

  describe("updateConsents", () => {
    const update = (consents: ConsentAgreementDto[]) =>
      service.updateConsents(userPk, { consents });

    it("inserts agreed consents and revokes optional ones in a transaction", async () => {
      await expect(
        update([...requiredAgreed, agree("marketing", "1.0", false)]),
      ).resolves.toBe(BaseResultDto.OK);

      expect(consentRepository.findLatestWithAgreement).toHaveBeenCalledWith(
        userPk,
        tx,
      );
      expect(consentRepository.insertAgreements).toHaveBeenCalledWith(
        userPk,
        requiredAgreed,
        tx,
      );
      expect(consentRepository.revokeByTypes).toHaveBeenCalledWith(
        userPk,
        ["marketing"],
        tx,
      );
    });

    it("leaves optional consents that are not in the request", async () => {
      await update(requiredAgreed);

      expect(consentRepository.revokeByTypes).toHaveBeenCalledWith(
        userPk,
        [],
        tx,
      );
    });

    it.each([
      ["a required consent is missing", [agree("terms_of_service", "2.0")]],
      [
        "a required consent is revoked",
        [
          agree("privacy_policy", "1.0", false),
          agree("terms_of_service", "2.0"),
        ],
      ],
      [
        "the version is not the latest",
        [agree("privacy_policy", "1.0"), agree("terms_of_service", "1.0")],
      ],
      ["the type does not exist", [...requiredAgreed, agree("unknown", "1.0")]],
      [
        "the type is duplicated",
        [...requiredAgreed, agree("privacy_policy", "1.0")],
      ],
    ])("throws 400 when %s", async (_, consents) => {
      await expect(update(consents)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(consentRepository.insertAgreements).not.toHaveBeenCalled();
      expect(consentRepository.revokeByTypes).not.toHaveBeenCalled();
    });
  });
});
