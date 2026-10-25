import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { users } from "../../../drizzle/schema/users";
import { hasMissingRequiredConsent } from "./consent.sql";

export type UserRow = typeof users.$inferSelect;

export type SignupProgress = {
  // 필수 약관의 최신 버전 중 유효한 동의가 없는 것이 있음
  hasMissingRequiredConsent: boolean;
  // student.verified_at / graduated.verified_at이 채워짐
  verified: boolean;
  // student_profile(버전 1개 이상) / graduated_profile 행이 있음
  hasProfile: boolean;
};

@Injectable()
export class UserRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM users WHERE pk = ?1 AND is_deleted = false;
   */
  async findByPk(userPk: string, tx?: TxType): Promise<UserRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(users)
      .where(and(eq(users.pk, userPk), eq(users.isDeleted, false)));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM users WHERE pk = ?1 AND is_deleted = false FOR UPDATE;
   */
  // 회원 탈퇴: 같은 유저의 동시 로그인과 겹치지 않도록 잠금 (로그인도 유저 행을 FOR UPDATE로 잠금).
  // 토큰 갱신은 잠그지 않아 탈퇴와 동시에 refresh하면 refresh token 행이 남을 수 있지만,
  // 갱신 때 탈퇴한 유저를 찾지 못해 401이므로 그 토큰으로는 더 쓸 수 없음
  async findByPkForUpdate(userPk: string, tx: TxType): Promise<UserRow | null> {
    const result = await tx
      .select()
      .from(users)
      .where(and(eq(users.pk, userPk), eq(users.isDeleted, false)))
      .for("update");

    return result[0] ?? null;
  }

  /*
  INSERT INTO users (pk, type, name, email) VALUES (?1, ?2, ?3, ?4) RETURNING *;
   */
  // 최초 OAuth 로그인. status는 기본값 pending
  async insert(
    row: Pick<UserRow, "type" | "name" | "email">,
    tx: TxType,
  ): Promise<UserRow> {
    const result = await tx
      .insert(users)
      .values({ pk: randomUUID(), ...row })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert user");
    }

    return result[0];
  }

  /*
  UPDATE users SET type = ?2, updated_at = now() WHERE pk = ?1;
   */
  async updateType(
    userPk: string,
    type: UserRow["type"],
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(users)
      .set({ type, updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET name = COALESCE(name, ?2), email = COALESCE(email, ?3), updated_at = now()
  WHERE pk = ?1;
   */
  // 이름은 한 번 저장하면 수정 불가라 비어 있을 때만 OAuth 값으로 채움 (Apple은 최초 로그인에만 줌)
  async fillProfileFromOAuth(
    userPk: string,
    profile: Pick<UserRow, "name" | "email">,
    tx: TxType,
  ): Promise<void> {
    if (!profile.name && !profile.email) return;
    await tx
      .update(users)
      .set({
        name: sql`COALESCE(${users.name}, ${profile.name})`,
        email: sql`COALESCE(${users.email}, ${profile.email})`,
        updatedAt: new Date(),
      })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET is_deleted = true, name = NULL, email = NULL, updated_at = now() WHERE pk = ?1;
   */
  // 회원 탈퇴: soft delete + 개인정보 제거
  async withdraw(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({ isDeleted: true, name: null, email: null, updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET last_active_at = now() WHERE pk = ?1 AND is_deleted = false;
   */
  // 내 정보 조회는 유저 조회와 동시에 호출하므로 탈퇴한 유저는 건드리지 않게 함
  async updateLastActiveAt(userPk: string, tx?: TxType): Promise<void> {
    await (tx ?? this.dbService.db)
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(users.pk, userPk), eq(users.isDeleted, false)));
  }

  // 가입 중(pending)인 유저의 진행 상황. 약관 최신 버전 규칙은 consent.sql.ts
  async findSignupProgress(
    userPk: string,
    type: UserRow["type"],
    tx?: TxType,
  ): Promise<SignupProgress> {
    const typeProgress =
      type === "student"
        ? sql`
          EXISTS (
            SELECT 1 FROM student s
            WHERE s.user_pk = ${userPk} AND s.verified_at IS NOT NULL
          ) AS verified,
          EXISTS (
            SELECT 1 FROM student s
            JOIN student_profile sp ON sp.student_pk = s.pk
            WHERE s.user_pk = ${userPk}
          ) AS has_profile`
        : sql`
          EXISTS (
            SELECT 1 FROM graduated g
            WHERE g.user_pk = ${userPk} AND g.verified_at IS NOT NULL
          ) AS verified,
          EXISTS (
            SELECT 1 FROM graduated g
            JOIN graduated_profile gp ON gp.graduated_pk = g.pk
            WHERE g.user_pk = ${userPk}
          ) AS has_profile`;

    const result = await (tx ?? this.dbService.db).execute<{
      has_missing_required_consent: boolean;
      verified: boolean;
      has_profile: boolean;
    }>(sql`
      SELECT
        ${hasMissingRequiredConsent(userPk)} AS has_missing_required_consent,
        ${typeProgress}
    `);

    const row = result.rows[0];
    return {
      hasMissingRequiredConsent: row.has_missing_required_consent,
      verified: row.verified,
      hasProfile: row.has_profile,
    };
  }
}
