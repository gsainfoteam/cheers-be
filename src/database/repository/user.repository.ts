import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { users } from "../../../drizzle/schema/users";

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
  UPDATE users SET last_active_at = now() WHERE pk = ?1;
   */
  async updateLastActiveAt(userPk: string, tx?: TxType): Promise<void> {
    await (tx ?? this.dbService.db)
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  // 가입 중(pending)인 유저의 진행 상황. 약관 최신 버전은 type별 (created_at, version)이 가장 큰 행.
  // 같은 트랜잭션에서 여러 버전을 넣으면 created_at(NOW())이 같으므로 version 문자열 순으로 가름
  // (문자열 비교라 v10 < v2 — 같은 시각에 넣을 때는 v1 → v2처럼 정렬 순서가 맞는 이름을 쓸 것)
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
        EXISTS (
          SELECT 1 FROM consent c
          WHERE c.is_required
            AND NOT EXISTS (
              SELECT 1 FROM consent newer
              WHERE newer.type = c.type
                AND (newer.created_at, newer.version) > (c.created_at, c.version)
            )
            AND NOT EXISTS (
              SELECT 1 FROM user_consent uc
              WHERE uc.user_pk = ${userPk}
                AND uc.consent_type = c.type
                AND uc.consent_version = c.version
                AND uc.revoked_at IS NULL
            )
        ) AS has_missing_required_consent,
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
