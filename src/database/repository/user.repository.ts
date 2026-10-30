import { Injectable } from "@nestjs/common";
import { and, asc, eq, lte, notInArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { users } from "@drizzle/schema/users";
import { hasMissingRequiredConsent } from "./consent.sql";
import { isActiveAccount } from "./user.sql";

export type UserRow = typeof users.$inferSelect;

export type SignupProgress = {
  // 필수 약관의 최신 버전 중 유효한 동의가 없는 것이 있음
  hasMissingRequiredConsent: boolean;
  // student.verified_at / graduated.verified_at이 채워짐
  verified: boolean;
  // student_profile(버전 1개 이상) / graduated_profile 행이 있음
  hasProfile: boolean;
};

// 탈퇴 요청을 처리할 기준 시각. 이보다 먼저 요청했으면 처리 대상
export type WithdrawalCutoffs = {
  // 가입을 마친(active) 유저: 요청 후 WITHDRAWAL_GRACE_DAYS일
  activeRequestedBefore: Date;
  // 가입 중(pending)에 탈퇴한 유저: 요청 후 1일
  pendingRequestedBefore: Date;
};

const isWithdrawalDue = (cutoffs: WithdrawalCutoffs) =>
  and(
    eq(users.isDeleted, false),
    or(
      and(
        eq(users.status, "active"),
        lte(users.withdrawRequestedAt, cutoffs.activeRequestedBefore),
      ),
      and(
        eq(users.status, "pending"),
        lte(users.withdrawRequestedAt, cutoffs.pendingRequestedBefore),
      ),
    ),
  );

// 가입 미완료 계정 정리 대상: 가입 후 · 마지막 활동 후 모두 일정 시간이 지난 pending 유저.
// 탈퇴 요청 여부와 soft delete 여부는 보지 않음 (탈퇴 스케줄러가 먼저 처리했어도 남은 행까지 지움)
const isIncompleteSignupDue = (cutoff: Date) =>
  and(
    eq(users.status, "pending"),
    lte(users.createdAt, cutoff),
    lte(users.lastActiveAt, cutoff),
  );

// 이 pk의 사용 중인 계정 (조건은 user.sql.ts의 isActiveAccount)
const isActiveAccountPk = (userPk: string) =>
  and(eq(users.pk, userPk), isActiveAccount);

@Injectable()
export class UserRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM users WHERE pk = ?1 AND is_deleted = false AND withdraw_requested_at IS NULL;
   */
  // 탈퇴 유예기간 중인 유저도 없는 것으로 봄 (가입 단계 가드 · 토큰 갱신 · 내 정보 → 401)
  async findByPk(userPk: string, tx?: TxType): Promise<UserRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(users)
      .where(isActiveAccountPk(userPk));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM users WHERE pk = ?1 AND is_deleted = false AND withdraw_requested_at IS NULL
  FOR UPDATE;
   */
  // 탈퇴 요청: 같은 유저의 동시 로그인과 겹치지 않도록 잠금 (로그인도 유저 행을 FOR UPDATE로 잠금).
  // 토큰 갱신은 잠그지 않아 탈퇴 요청과 동시에 refresh하면 refresh token 행이 남을 수 있지만,
  // 갱신 때 탈퇴 요청한 유저를 찾지 못해 401이므로 그 토큰으로는 더 쓸 수 없음
  async findByPkForUpdate(userPk: string, tx: TxType): Promise<UserRow | null> {
    const result = await tx
      .select()
      .from(users)
      .where(isActiveAccountPk(userPk))
      .for("update");

    return result[0] ?? null;
  }

  /*
  INSERT INTO users (pk, type, email) VALUES (?1, ?2, ?3) RETURNING *;
   */
  // 최초 OAuth 로그인. status는 기본값 pending, name은 추가 정보 입력에서 채움
  async insert(
    row: Pick<UserRow, "type" | "email">,
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
  UPDATE users SET email = COALESCE(email, ?2), updated_at = now() WHERE pk = ?1;
   */
  // 재로그인: 비어 있을 때만 OAuth 이메일로 채움
  async fillEmail(userPk: string, email: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({
        email: sql`COALESCE(${users.email}, ${email})`,
        updatedAt: new Date(),
      })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET name = COALESCE(name, ?2), updated_at = now() WHERE pk = ?1;
   */
  // 추가 정보 입력: 첫 저장 때 한 번만 저장. 이미 있으면 그대로 (수정 불가)
  async fillName(userPk: string, name: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({
        name: sql`COALESCE(${users.name}, ${name})`,
        updatedAt: new Date(),
      })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET status = 'active', updated_at = now() WHERE pk = ?1;
   */
  // 가입 완료 (추가 정보 입력). 호출한 쪽에서 새 status로 토큰을 재발급
  async activate(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET withdraw_requested_at = now(), updated_at = now() WHERE pk = ?1;
   */
  // 탈퇴 요청: 유예기간 시작
  async requestWithdrawal(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({ withdrawRequestedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET withdraw_requested_at = NULL, updated_at = now() WHERE pk = ?1;
   */
  // 유예기간 중 다시 로그인하면 탈퇴 취소
  async cancelWithdrawal(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({ withdrawRequestedAt: null, updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  SELECT pk FROM users
  WHERE is_deleted = false AND (
    (status = 'active' AND withdraw_requested_at <= ?1) OR
    (status = 'pending' AND withdraw_requested_at <= ?2)
  ) AND pk NOT IN (?4)
  ORDER BY withdraw_requested_at LIMIT ?3;
   */
  // 유예기간이 끝난 탈퇴 요청 (스케줄러). 이번 실행에서 이미 시도한 유저는 빼고 조회
  async findWithdrawalDuePks(
    cutoffs: WithdrawalCutoffs,
    limit: number,
    excludePks: string[],
  ): Promise<string[]> {
    const result = await this.dbService.db
      .select({ pk: users.pk })
      .from(users)
      .where(
        and(
          isWithdrawalDue(cutoffs),
          excludePks.length > 0 ? notInArray(users.pk, excludePks) : undefined,
        ),
      )
      .orderBy(asc(users.withdrawRequestedAt))
      .limit(limit);

    return result.map((row) => row.pk);
  }

  /*
  SELECT * FROM users WHERE pk = ?1 AND is_deleted = false AND (
    (status = 'active' AND withdraw_requested_at <= ?2) OR
    (status = 'pending' AND withdraw_requested_at <= ?3)
  ) FOR UPDATE SKIP LOCKED;
   */
  // 스케줄러가 처리할 유저를 잠금. 다른 인스턴스가 처리 중이거나 같은 유저가 로그인(탈퇴 취소) 중이면
  // 기다리지 않고 null. 잠근 뒤 다시 확인하므로 그 사이 취소됐으면 null
  async lockWithdrawalDue(
    userPk: string,
    cutoffs: WithdrawalCutoffs,
    tx: TxType,
  ): Promise<UserRow | null> {
    const result = await tx
      .select()
      .from(users)
      .where(and(eq(users.pk, userPk), isWithdrawalDue(cutoffs)))
      .for("update", { skipLocked: true });

    return result[0] ?? null;
  }

  /*
  SELECT pk FROM users WHERE status = 'pending' AND created_at <= ?1 AND last_active_at <= ?1
  AND pk NOT IN (?3) ORDER BY created_at LIMIT ?2;
   */
  // 가입 미완료 계정 정리 스케줄러. 이번 실행에서 이미 시도한 유저는 빼고 조회
  async findIncompleteSignupPks(
    cutoff: Date,
    limit: number,
    excludePks: string[],
  ): Promise<string[]> {
    const result = await this.dbService.db
      .select({ pk: users.pk })
      .from(users)
      .where(
        and(
          isIncompleteSignupDue(cutoff),
          excludePks.length > 0 ? notInArray(users.pk, excludePks) : undefined,
        ),
      )
      .orderBy(asc(users.createdAt))
      .limit(limit);

    return result.map((row) => row.pk);
  }

  /*
  SELECT * FROM users WHERE pk = ?1 AND status = 'pending' AND created_at <= ?2 AND last_active_at <= ?2
  FOR UPDATE SKIP LOCKED;
   */
  // 삭제할 유저를 잠금. 다른 인스턴스 · 탈퇴 스케줄러가 처리 중이거나 같은 유저가 로그인 · 가입 진행 중이면
  // 기다리지 않고 null. 잠근 뒤 다시 확인하므로 그 사이 가입을 마치거나 활동했으면 null
  async lockIncompleteSignup(
    userPk: string,
    cutoff: Date,
    tx: TxType,
  ): Promise<UserRow | null> {
    const result = await tx
      .select()
      .from(users)
      .where(and(eq(users.pk, userPk), isIncompleteSignupDue(cutoff)))
      .for("update", { skipLocked: true });

    return result[0] ?? null;
  }

  /*
  DELETE FROM users WHERE pk = ?1;
   */
  // 가입 미완료 계정 정리: hard delete. FK가 NO ACTION이라 자식 행을 모두 지운 뒤에 호출
  async deleteByPk(userPk: string, tx: TxType): Promise<void> {
    await tx.delete(users).where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET is_deleted = true, name = NULL, email = NULL, updated_at = now() WHERE pk = ?1;
   */
  // 탈퇴 유예기간 만료: soft delete + 개인정보 제거. withdraw_requested_at은 기록으로 남김
  async withdraw(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(users)
      .set({ isDeleted: true, name: null, email: null, updatedAt: new Date() })
      .where(eq(users.pk, userPk));
  }

  /*
  UPDATE users SET last_active_at = now()
  WHERE pk = ?1 AND is_deleted = false AND withdraw_requested_at IS NULL;
   */
  // 내 정보 조회는 유저 조회와 동시에 호출하므로 탈퇴(요청)한 유저는 건드리지 않게 함.
  // 로그인은 탈퇴 취소 뒤에 호출되므로 갱신됨
  async updateLastActiveAt(userPk: string, tx?: TxType): Promise<void> {
    await (tx ?? this.dbService.db)
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(isActiveAccountPk(userPk));
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
