import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { coffeeChatContact } from "../../../drizzle/schema/coffee-chat-contact";

export type CoffeeChatContactRow = typeof coffeeChatContact.$inferSelect;

@Injectable()
export class CoffeeChatContactRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM coffee_chat_contact WHERE user_pk = ?1;
   */
  async findByUserPk(
    userPk: string,
    tx?: TxType,
  ): Promise<CoffeeChatContactRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(coffeeChatContact)
      .where(eq(coffeeChatContact.userPk, userPk));

    return result[0] ?? null;
  }

  /*
  INSERT INTO coffee_chat_contact (user_pk, kakao_enabled, email_enabled, phone, email)
  VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (user_pk) DO UPDATE SET
    kakao_enabled = ?2, email_enabled = ?3, phone = ?4, email = ?5, updated_at = now();
   */
  // 추가 정보 저장에서 함께 저장. 버전 관리 안 함
  async upsert(
    row: Pick<
      CoffeeChatContactRow,
      "userPk" | "kakaoEnabled" | "emailEnabled" | "phone" | "email"
    >,
    tx: TxType,
  ): Promise<void> {
    await tx
      .insert(coffeeChatContact)
      .values(row)
      .onConflictDoUpdate({
        target: coffeeChatContact.userPk,
        set: {
          kakaoEnabled: row.kakaoEnabled,
          emailEnabled: row.emailEnabled,
          phone: row.phone,
          email: row.email,
          updatedAt: new Date(),
        },
      });
  }

  /*
  DELETE FROM coffee_chat_contact WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 연락처(전화번호 · 이메일)는 개인정보라 삭제
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(coffeeChatContact)
      .where(eq(coffeeChatContact.userPk, userPk));
  }
}
