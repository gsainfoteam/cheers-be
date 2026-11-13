import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, lt, SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import {
  AdminAuditAction,
  adminAuditLog,
  AdminAuditSnapshot,
  AdminAuditTargetType,
} from "@drizzle/schema/admin-audit-log";

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;

export type AdminAuditLogEntry = {
  adminEmail: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId?: string | number | null;
  // 생성이면 생략
  before?: AdminAuditSnapshot | null;
  // 삭제면 생략
  after?: AdminAuditSnapshot | null;
};

export type AdminAuditLogFilter = {
  // 이메일 부분 일치 (대소문자 무시)
  adminEmail?: string;
  action?: AdminAuditAction;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  // 기록 시각 [createdFrom, createdTo)
  createdFrom?: Date;
  createdTo?: Date;
};

export type AdminAuditLogPage = {
  rows: AdminAuditLogRow[];
  total: number;
};

// LIKE 와일드카드(% _ \)를 글자 그대로 찾도록 막음
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const toConditions = (filter: AdminAuditLogFilter): SQL | undefined =>
  and(
    filter.adminEmail &&
      ilike(adminAuditLog.adminEmail, `%${escapeLike(filter.adminEmail)}%`),
    filter.action && eq(adminAuditLog.action, filter.action),
    filter.targetType && eq(adminAuditLog.targetType, filter.targetType),
    filter.targetId && eq(adminAuditLog.targetId, filter.targetId),
    filter.createdFrom && gte(adminAuditLog.createdAt, filter.createdFrom),
    filter.createdTo && lt(adminAuditLog.createdAt, filter.createdTo),
  );

@Injectable()
export class AdminAuditLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO admin_audit_log (pk, admin_email, action, target_type, target_id, before, after)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);
   */
  // 감사 로그는 변경과 같이 커밋 · rollback돼야 하므로 변경하는 트랜잭션의 tx를 넘김
  async insert(entry: AdminAuditLogEntry, tx: TxType): Promise<void> {
    await tx.insert(adminAuditLog).values({
      pk: randomUUID(),
      adminEmail: entry.adminEmail,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId == null ? null : String(entry.targetId),
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }

  /*
  SELECT * FROM admin_audit_log WHERE <filter>
  ORDER BY created_at DESC, pk DESC LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM admin_audit_log WHERE <filter>;
   */
  async findPage(
    filter: AdminAuditLogFilter,
    offset: number,
    limit: number,
  ): Promise<AdminAuditLogPage> {
    const db = this.dbService.db;
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(adminAuditLog)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.pk))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(adminAuditLog).where(where),
    ]);
    return { rows, total };
  }
}
