import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, lt, SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";

export type AdminAccessLogRow = typeof adminAccessLog.$inferSelect;

export type AdminAccessLogFilter = {
  // 이메일 부분 일치 (대소문자 무시)
  adminEmail?: string;
  targetType?: AdminAccessLogRow["targetType"];
  // 기록 시각 [createdFrom, createdTo)
  createdFrom?: Date;
  createdTo?: Date;
};

export type AdminAccessLogPage = {
  rows: AdminAccessLogRow[];
  total: number;
};

// LIKE 와일드카드(% _ \)를 글자 그대로 찾도록 막음
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const toConditions = (filter: AdminAccessLogFilter): SQL | undefined =>
  and(
    filter.adminEmail &&
      ilike(adminAccessLog.adminEmail, `%${escapeLike(filter.adminEmail)}%`),
    filter.targetType && eq(adminAccessLog.targetType, filter.targetType),
    filter.createdFrom && gte(adminAccessLog.createdAt, filter.createdFrom),
    filter.createdTo && lt(adminAccessLog.createdAt, filter.createdTo),
  );

@Injectable()
export class AdminAccessLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO admin_access_log (pk, admin_email, target_type, target_id) VALUES (?1, ?2, ?3, ?4);
   */
  // tx를 넘기면 그 작업과 같이 커밋 · rollback됨
  async insert(
    row: Pick<AdminAccessLogRow, "adminEmail" | "targetType" | "targetId">,
    tx?: TxType,
  ): Promise<void> {
    await (tx ?? this.dbService.db)
      .insert(adminAccessLog)
      .values({ pk: randomUUID(), ...row });
  }

  /*
  SELECT * FROM admin_access_log WHERE <filter>
  ORDER BY created_at DESC, pk DESC LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM admin_access_log WHERE <filter>;
   */
  async findPage(
    filter: AdminAccessLogFilter,
    offset: number,
    limit: number,
  ): Promise<AdminAccessLogPage> {
    const db = this.dbService.db;
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(adminAccessLog)
        .where(where)
        .orderBy(desc(adminAccessLog.createdAt), desc(adminAccessLog.pk))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(adminAccessLog).where(where),
    ]);
    return { rows, total };
  }
}
