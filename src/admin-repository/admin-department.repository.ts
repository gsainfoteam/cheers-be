import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { department } from "@drizzle/schema/department";

export type AdminDepartmentRow = typeof department.$inferSelect;

@Injectable()
export class AdminDepartmentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM department WHERE school_pk = ?1 ORDER BY pk;
   */
  // 앱 API와 달리 비활성 학과도 포함
  async findBySchoolPk(schoolPk: number): Promise<AdminDepartmentRow[]> {
    return this.dbService.db
      .select()
      .from(department)
      .where(eq(department.schoolPk, schoolPk))
      .orderBy(asc(department.pk));
  }

  /*
  INSERT INTO department (school_pk, name) VALUES (?1, ?2)
  ON CONFLICT (school_pk, name) DO NOTHING RETURNING *;
   */
  // 같은 학교에 같은 이름이 있으면 (비활성 학과 포함) null
  async insertIfAbsent(
    schoolPk: number,
    name: string,
  ): Promise<AdminDepartmentRow | null> {
    const result = await this.dbService.db
      .insert(department)
      .values({ schoolPk, name })
      .onConflictDoNothing({ target: [department.schoolPk, department.name] })
      .returning();

    return result[0] ?? null;
  }

  /*
  UPDATE department SET name = ?3, is_active = ?4
  WHERE pk = ?1 AND school_pk = ?2 RETURNING *;
   */
  // 없는 학과이거나 다른 학교의 학과면 null. 같은 학교에 같은 이름이 있으면 UNIQUE 위반
  async update(
    schoolPk: number,
    pk: number,
    values: Partial<Pick<AdminDepartmentRow, "name" | "isActive">>,
    tx: TxType,
  ): Promise<AdminDepartmentRow | null> {
    const result = await tx
      .update(department)
      .set(values)
      .where(and(eq(department.pk, pk), eq(department.schoolPk, schoolPk)))
      .returning();

    return result[0] ?? null;
  }

  /*
  SELECT pk FROM department WHERE school_pk = ?1 AND is_active LIMIT 1;
   */
  async existsActiveBySchoolPk(schoolPk: number, tx: TxType): Promise<boolean> {
    const result = await tx
      .select({ pk: department.pk })
      .from(department)
      .where(
        and(eq(department.schoolPk, schoolPk), eq(department.isActive, true)),
      )
      .limit(1);

    return result.length > 0;
  }
}
