import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { adminAccount } from "@drizzle/schema/admin-account";

export type AdminAccountRow = typeof adminAccount.$inferSelect;
export type AdminAccountRole = AdminAccountRow["role"];

@Injectable()
export class AdminAccountRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM admin_account ORDER BY created_at;
   */
  async findAll(): Promise<AdminAccountRow[]> {
    return this.dbService.db
      .select()
      .from(adminAccount)
      .orderBy(asc(adminAccount.createdAt));
  }

  /*
  SELECT * FROM admin_account WHERE email = ?1;
   */
  async findByEmail(email: string): Promise<AdminAccountRow | null> {
    const result = await this.dbService.db
      .select()
      .from(adminAccount)
      .where(eq(adminAccount.email, email));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM admin_account WHERE pk = ?1;
   */
  async findByPk(pk: string): Promise<AdminAccountRow | null> {
    const result = await this.dbService.db
      .select()
      .from(adminAccount)
      .where(eq(adminAccount.pk, pk));

    return result[0] ?? null;
  }

  /*
  INSERT INTO admin_account (pk, email, role) VALUES (?1, ?2, ?3)
  ON CONFLICT (email) DO NOTHING RETURNING *;
   */
  // 이미 등록된 이메일이면 null
  async insertIfAbsent(
    row: Pick<AdminAccountRow, "email" | "role">,
  ): Promise<AdminAccountRow | null> {
    const result = await this.dbService.db
      .insert(adminAccount)
      .values({ pk: randomUUID(), ...row })
      .onConflictDoNothing({ target: adminAccount.email })
      .returning();

    return result[0] ?? null;
  }

  /*
  UPDATE admin_account SET role = ?2, updated_at = NOW() WHERE pk = ?1 RETURNING *;
   */
  // 그 사이 삭제됐으면 null
  async updateRole(
    pk: string,
    role: AdminAccountRole,
  ): Promise<AdminAccountRow | null> {
    const result = await this.dbService.db
      .update(adminAccount)
      .set({ role, updatedAt: new Date() })
      .where(eq(adminAccount.pk, pk))
      .returning();

    return result[0] ?? null;
  }

  /*
  DELETE FROM admin_account WHERE pk = ?1 AND role = 'admin' RETURNING pk;
   */
  // superadmin은 지우지 않음. 지운 행이 없으면 false
  async deleteAdminByPk(pk: string): Promise<boolean> {
    const result = await this.dbService.db
      .delete(adminAccount)
      .where(and(eq(adminAccount.pk, pk), eq(adminAccount.role, "admin")))
      .returning({ pk: adminAccount.pk });

    return result.length > 0;
  }
}
