import { Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { TxType } from "@src/global/types/tx.types";
import { interest } from "@drizzle/schema/interest";

export type AdminInterestRow = typeof interest.$inferSelect;

@Injectable()
export class AdminInterestRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  LOCK TABLE interest IN SHARE ROW EXCLUSIVE MODE;
   */
  // 어드민 쓰기를 한 줄로 세움. sort_order의 MAX + 1과 이름 중복 확인이 어긋나지 않게 하며, SELECT는 막지 않음
  async lockForWrite(tx: TxType): Promise<void> {
    await tx.execute(sql`LOCK TABLE ${interest} IN SHARE ROW EXCLUSIVE MODE`);
  }

  /*
  SELECT * FROM interest ORDER BY sort_order, pk;
   */
  async findAll(tx?: TxType): Promise<AdminInterestRow[]> {
    return (tx ?? this.dbService.db)
      .select()
      .from(interest)
      .orderBy(asc(interest.sortOrder), asc(interest.pk));
  }

  /*
  SELECT * FROM interest WHERE pk = ?1;
   */
  async findByPk(pk: number, tx: TxType): Promise<AdminInterestRow | null> {
    const result = await tx.select().from(interest).where(eq(interest.pk, pk));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM interest WHERE name = ?1;
   */
  async findByName(name: string, tx: TxType): Promise<AdminInterestRow | null> {
    const result = await tx
      .select()
      .from(interest)
      .where(eq(interest.name, name));

    return result[0] ?? null;
  }

  /*
  INSERT INTO interest (name, sort_order)
  VALUES (?1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM interest))
  RETURNING *;
   */
  // lockForWrite 뒤에 호출하므로 sort_order가 겹치지 않음
  async insert(name: string, tx: TxType): Promise<AdminInterestRow> {
    const result = await tx
      .insert(interest)
      .values({
        name,
        sortOrder: sql`(SELECT COALESCE(MAX(${interest.sortOrder}), 0) + 1 FROM ${interest})`,
      })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert interest");
    }

    return result[0];
  }

  /*
  UPDATE interest SET name = ?2 WHERE pk = ?1 RETURNING *;
   */
  async updateName(
    pk: number,
    name: string,
    tx: TxType,
  ): Promise<AdminInterestRow> {
    const result = await tx
      .update(interest)
      .set({ name })
      .where(eq(interest.pk, pk))
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to update interest");
    }

    return result[0];
  }

  /*
  UPDATE interest SET sort_order = ?2 WHERE pk = ?1;
   */
  async updateSortOrder(
    pk: number,
    sortOrder: number,
    tx: TxType,
  ): Promise<void> {
    await tx.update(interest).set({ sortOrder }).where(eq(interest.pk, pk));
  }

  /*
  DELETE FROM interest WHERE pk = ?1 RETURNING pk;
   */
  // 지운 행이 없으면 false
  async deleteByPk(pk: number): Promise<boolean> {
    const result = await this.dbService.db
      .delete(interest)
      .where(eq(interest.pk, pk))
      .returning({ pk: interest.pk });

    return result.length > 0;
  }
}
