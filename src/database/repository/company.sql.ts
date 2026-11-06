import { eq, SQL, sql } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { companyAlias } from "@drizzle/schema/company-alias";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";

// 현업자 회사 쿼리 공용 조각 (CRB-68)
// 화면에 나가는 회사 이름은 company_alias.name

// .innerJoin(companyAlias, isProfileCompany)
export const isProfileCompany: SQL = eq(
  companyAlias.pk,
  graduatedProfile.companyAliasPk,
);

// 같은 표기(normalized_name)를 동시에 등록할 때 직렬화하는 트랜잭션 잠금 (끝나면 풀림)
// 현업자의 직접 입력(CompanyRepository)과 어드민 등록(AdminCompanyRepository)이 같은 키를 씀
export const lockCompanyName = async (
  tx: TxType,
  normalized: string,
): Promise<void> => {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`company:${normalized}`}))`,
  );
};
