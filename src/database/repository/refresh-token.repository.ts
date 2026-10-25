import { Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { refreshToken } from "../../../drizzle/schema/refresh-token";

export type RefreshTokenRow = typeof refreshToken.$inferSelect;

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO refresh_token (opaque_hash, user_pk, expires_at) VALUES (?1, ?2, ?3) RETURNING *;
   */
  async insert(
    row: Pick<RefreshTokenRow, "opaqueHash" | "userPk" | "expiresAt">,
    tx: TxType,
  ): Promise<RefreshTokenRow> {
    const result = await tx.insert(refreshToken).values(row).returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert refresh token");
    }

    return result[0];
  }

  /*
  DELETE FROM refresh_token WHERE opaque_hash = ?1 RETURNING *;
   */
  // rotation 시 기존 토큰을 원자적으로 소비. 동시에 두 번 refresh하면 한쪽만 행을 받음
  async deleteByOpaqueHash(
    opaqueHash: string,
    tx: TxType,
  ): Promise<RefreshTokenRow | null> {
    const result = await tx
      .delete(refreshToken)
      .where(eq(refreshToken.opaqueHash, opaqueHash))
      .returning();

    return result[0] ?? null;
  }

  /*
  DELETE FROM refresh_token WHERE opaque_hash = ?1 AND user_pk = ?2;
   */
  async deleteByOpaqueHashAndUserPk(
    opaqueHash: string,
    userPk: string,
    tx: TxType,
  ): Promise<void> {
    await tx
      .delete(refreshToken)
      .where(
        and(
          eq(refreshToken.opaqueHash, opaqueHash),
          eq(refreshToken.userPk, userPk),
        ),
      );
  }

  /*
  DELETE FROM refresh_token WHERE user_pk = ?1;
   */
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx.delete(refreshToken).where(eq(refreshToken.userPk, userPk));
  }

  /*
  DELETE FROM refresh_token WHERE expires_at < now();
   */
  async deleteExpired(tx: TxType): Promise<number> {
    const result = await tx
      .delete(refreshToken)
      .where(lt(refreshToken.expiresAt, new Date()))
      .returning({ opaqueHash: refreshToken.opaqueHash });

    return result.length;
  }
}
