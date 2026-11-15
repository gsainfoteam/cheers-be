import { Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { alimtalkTemplate } from "@drizzle/schema/alimtalk-template";

export type AdminAlimtalkTemplateRow = typeof alimtalkTemplate.$inferSelect;

export type AdminAlimtalkTemplateUpdate = Partial<
  Pick<AdminAlimtalkTemplateRow, "tplCode" | "title" | "message" | "buttonName">
>;

@Injectable()
export class AdminAlimtalkTemplateRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM alimtalk_template ORDER BY event;
   */
  async findAll(): Promise<AdminAlimtalkTemplateRow[]> {
    return this.dbService.db
      .select()
      .from(alimtalkTemplate)
      .orderBy(asc(alimtalkTemplate.event));
  }

  /*
  SELECT * FROM alimtalk_template WHERE event = ?1 FOR UPDATE;
   */
  async findByEventForUpdate(
    event: AdminAlimtalkTemplateRow["event"],
    tx: TxType,
  ): Promise<AdminAlimtalkTemplateRow | null> {
    const result = await tx
      .select()
      .from(alimtalkTemplate)
      .where(eq(alimtalkTemplate.event, event))
      .for("update");
    return result[0] ?? null;
  }

  /*
  UPDATE alimtalk_template SET ..., updated_at = NOW() WHERE event = ?1 RETURNING *;
   */
  async update(
    event: AdminAlimtalkTemplateRow["event"],
    fields: AdminAlimtalkTemplateUpdate,
    tx: TxType,
  ): Promise<AdminAlimtalkTemplateRow> {
    const result = await tx
      .update(alimtalkTemplate)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(alimtalkTemplate.event, event))
      .returning();
    return result[0];
  }
}
