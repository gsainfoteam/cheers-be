import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";

export type AdminAccessLogRow = typeof adminAccessLog.$inferSelect;

@Injectable()
export class AdminAccessLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO admin_access_log (pk, admin_email, target_type, target_id) VALUES (?1, ?2, ?3, ?4);
   */
  async insert(
    row: Pick<AdminAccessLogRow, "adminEmail" | "targetType" | "targetId">,
  ): Promise<void> {
    await this.dbService.db
      .insert(adminAccessLog)
      .values({ pk: randomUUID(), ...row });
  }
}
