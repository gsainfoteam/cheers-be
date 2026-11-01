import { Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { school } from "@drizzle/schema/school";

export type AdminSchoolRow = typeof school.$inferSelect;

@Injectable()
export class AdminSchoolRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM school ORDER BY pk;
   */
  async findAll(): Promise<AdminSchoolRow[]> {
    return this.dbService.db.select().from(school).orderBy(asc(school.pk));
  }

  /*
  SELECT * FROM school WHERE pk = ?1;
   */
  async findByPk(pk: number): Promise<AdminSchoolRow | null> {
    const result = await this.dbService.db
      .select()
      .from(school)
      .where(eq(school.pk, pk));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM school WHERE pk = ?1 FOR UPDATE;
   */
  // 같은 학교의 허용 도메인 동시 변경을 직렬화
  async findByPkForUpdate(
    pk: number,
    tx: TxType,
  ): Promise<AdminSchoolRow | null> {
    const result = await tx
      .select()
      .from(school)
      .where(eq(school.pk, pk))
      .for("update");

    return result[0] ?? null;
  }
}
