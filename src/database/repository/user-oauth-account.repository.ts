import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { UserRow } from "@src/database/repository/user.repository";
import { userOauthAccount } from "../../../drizzle/schema/user-oauth-account";
import { users } from "../../../drizzle/schema/users";

export type UserOauthAccountRow = typeof userOauthAccount.$inferSelect;

@Injectable()
export class UserOauthAccountRepository {
  /*
  SELECT u.* FROM user_oauth_account a JOIN users u ON u.pk = a.user_pk
  WHERE a.provider = ?1 AND a.provider_sub = ?2 AND u.is_deleted = false
  FOR UPDATE OF u;
   */
  // 같은 계정으로 동시에 로그인해도 유형 변경이 겹치지 않도록 유저 행을 잠금
  async findUserForLogin(
    provider: UserOauthAccountRow["provider"],
    providerSub: string,
    tx: TxType,
  ): Promise<UserRow | null> {
    const result = await tx
      .select({ user: users })
      .from(userOauthAccount)
      .innerJoin(users, eq(users.pk, userOauthAccount.userPk))
      .where(
        and(
          eq(userOauthAccount.provider, provider),
          eq(userOauthAccount.providerSub, providerSub),
          eq(users.isDeleted, false),
        ),
      )
      .for("update", { of: users });

    return result[0]?.user ?? null;
  }

  /*
  INSERT INTO user_oauth_account (provider, provider_sub, user_pk, email, last_login_at)
  VALUES (?1, ?2, ?3, ?4, now())
  ON CONFLICT DO NOTHING RETURNING *;
   */
  // 같은 provider 계정으로 동시에 최초 로그인하면 한쪽만 행을 받음
  async insert(
    row: Pick<
      UserOauthAccountRow,
      "provider" | "providerSub" | "userPk" | "email"
    >,
    tx: TxType,
  ): Promise<UserOauthAccountRow | null> {
    const result = await tx
      .insert(userOauthAccount)
      .values({ ...row, lastLoginAt: new Date() })
      .onConflictDoNothing()
      .returning();

    return result[0] ?? null;
  }

  /*
  UPDATE user_oauth_account SET last_login_at = now(), email = COALESCE(?3, email)
  WHERE provider = ?1 AND provider_sub = ?2;
   */
  async updateLastLogin(
    provider: UserOauthAccountRow["provider"],
    providerSub: string,
    email: string | null,
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(userOauthAccount)
      .set({ lastLoginAt: new Date(), ...(email ? { email } : {}) })
      .where(
        and(
          eq(userOauthAccount.provider, provider),
          eq(userOauthAccount.providerSub, providerSub),
        ),
      );
  }

  /*
  DELETE FROM user_oauth_account WHERE user_pk = ?1;
   */
  // 회원 탈퇴. hard delete라 같은 OAuth 계정으로 다시 가입 가능
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(userOauthAccount)
      .where(eq(userOauthAccount.userPk, userPk));
  }
}
