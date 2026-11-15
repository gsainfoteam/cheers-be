import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { alimtalkTemplate } from "@drizzle/schema/alimtalk-template";
import { NotificationEvent } from "./notification.types";

export type AlimtalkTemplateRow = typeof alimtalkTemplate.$inferSelect;

@Injectable()
export class AlimtalkTemplateRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM alimtalk_template;
   */
  async findAll(): Promise<AlimtalkTemplateRow[]> {
    return this.dbService.db.select().from(alimtalkTemplate);
  }

  /*
  UPDATE alimtalk_template SET tpl_code = ?2, updated_at = NOW()
  WHERE event = ?1 AND tpl_code = '';
   */
  // 템플릿 코드가 비어 있는 이벤트만 채움 (환경변수에서 옮겨 올 때). 어드민이 넣은 값은 덮어쓰지 않음.
  // 채웠으면 true
  async fillEmptyTplCode(
    event: NotificationEvent,
    tplCode: string,
  ): Promise<boolean> {
    const result = await this.dbService.db
      .update(alimtalkTemplate)
      .set({ tplCode, updatedAt: new Date() })
      .where(
        and(
          eq(alimtalkTemplate.event, event),
          eq(alimtalkTemplate.tplCode, ""),
        ),
      )
      .returning({ event: alimtalkTemplate.event });
    return result.length > 0;
  }
}
