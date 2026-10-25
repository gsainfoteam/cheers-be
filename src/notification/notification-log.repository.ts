import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { notificationLog } from "../../drizzle/schema/notification-log";
import { NotificationLogInput } from "./notification.types";

// insert만 함. 재시도도 새 행
@Injectable()
export class NotificationLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  async insert(input: NotificationLogInput): Promise<void> {
    await this.dbService.db.insert(notificationLog).values({
      pk: randomUUID(),
      ...input,
    });
  }
}
