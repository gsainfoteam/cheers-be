import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";

export type AdminAccessLogRow = typeof adminAccessLog.$inferSelect;

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
}
