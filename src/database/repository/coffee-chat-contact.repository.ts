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
  DELETE FROM coffee_chat_contact WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 연락처(전화번호 · 이메일)는 개인정보라 삭제
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(coffeeChatContact)
      .where(eq(coffeeChatContact.userPk, userPk));
  }
}
