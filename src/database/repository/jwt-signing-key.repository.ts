import { Injectable } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";
import { jwtSigningKey } from "@drizzle/schema/jwt-signing-key";

export type JwtSigningKeyRow = typeof jwtSigningKey.$inferSelect;

@Injectable()
export class JwtSigningKeyRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM jwt_signing_key LIMIT 1;
   */
  async find(): Promise<JwtSigningKeyRow | null> {
    const result = await this.dbService.db
      .select()
      .from(jwtSigningKey)
      .limit(1);

    return result[0] ?? null;
  }

  /*
  INSERT INTO jwt_signing_key (private_key, public_key) VALUES (?1, ?2)
  ON CONFLICT DO NOTHING RETURNING *;
   */
  // 다른 replica가 먼저 넣었으면 null. 그 트랜잭션이 커밋될 때까지 기다린 뒤 반환하므로 바로 다시 읽으면 보임
  async insertIfAbsent(
    row: Pick<JwtSigningKeyRow, "privateKey" | "publicKey">,
  ): Promise<JwtSigningKeyRow | null> {
    const result = await this.dbService.db
      .insert(jwtSigningKey)
      .values(row)
      .onConflictDoNothing()
      .returning();

    return result[0] ?? null;
  }
}
