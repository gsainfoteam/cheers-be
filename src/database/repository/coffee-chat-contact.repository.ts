import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { coffeeChatContact } from "../../../drizzle/schema/coffee-chat-contact";

export type CoffeeChatContactRow = typeof coffeeChatContact.$inferSelect;

export type CoffeeChatContactInput = Pick<
  CoffeeChatContactRow,
  "kakaoEnabled" | "emailEnabled" | "phone" | "email"
>;

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
    kakao_enabled = EXCLUDED.kakao_enabled, email_enabled = EXCLUDED.email_enabled,
    phone = EXCLUDED.phone, email = EXCLUDED.email, updated_at = now();
   */
  // 추가 정보 저장 API에서 함께 저장 (버전 관리 안 함)
  async upsert(
    userPk: string,
    contact: CoffeeChatContactInput,
    tx: TxType,
  ): Promise<void> {
    await tx
      .insert(coffeeChatContact)
      .values({ userPk, ...contact })
      .onConflictDoUpdate({
        target: coffeeChatContact.userPk,
        set: { ...contact, updatedAt: new Date() },
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
