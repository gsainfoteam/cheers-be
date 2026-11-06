import { eq, SQL, sql } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { companyAlias } from "@drizzle/schema/company-alias";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";

// 현업자 회사 쿼리 공용 조각 (CRB-68)
// 화면에 나가는 회사 이름은 company_alias.name. 이전 버전 pod가 회사 없이 저장한 프로필(company_alias_pk IS NULL)은
// 저장 당시 입력값(graduated_profile.company)으로 대신함. 다음 릴리스에서 company 컬럼을 지우면 company_alias.name 만 씀

// .leftJoin(companyAlias, isProfileCompany)
export const isProfileCompany: SQL = eq(
  companyAlias.pk,
  graduatedProfile.companyAliasPk,
);

// select 컬럼: { company: profileCompanyName }
export const profileCompanyName = sql<string>`COALESCE(${companyAlias.name}, ${graduatedProfile.company})`;

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
