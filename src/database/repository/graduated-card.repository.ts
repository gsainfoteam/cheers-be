import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, SQL, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CoffeeChatContactRow } from "@src/database/repository/coffee-chat-contact.repository";
import { graduated } from "../../../drizzle/schema/graduated";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";
import { users } from "../../../drizzle/schema/users";
import { coffeeChatContact } from "../../../drizzle/schema/coffee-chat-contact";
import { isActiveAccount } from "./user.sql";

export type GraduatedCardSort = "recent_joined" | "recent_active" | "random";

export type GraduatedCardRow = {
  graduatedPk: string;
  nickname: string;
  company: string;
  job: string;
  hashtags: string[] | null;
  links: string[] | null;
  lastActiveAt: Date;
  // 연락 설정에서 이메일 · 알림톡 중 하나라도 켬 (설정이 없으면 false)
  canRequest: boolean;
};

export type GraduatedCardPage = {
  rows: GraduatedCardRow[];
  total: number;
};

export type GraduatedRequestTarget = {
  graduatedPk: string;
  name: string | null;
  // 연락 설정이 없으면 null
  contact: CoffeeChatContactRow | null;
};

// 다른 회원(재학생)에게 보이는 현업자: 가입을 마쳤고(active) 탈퇴 · 탈퇴 유예기간 중이 아님 (user.sql.ts)
const isVisibleGraduated = and(
  eq(users.type, "graduated"),
  eq(users.status, "active"),
  isActiveAccount,
);

// 현업자 목록 · 커피챗 요청 대상 조회 (읽기 전용). 추가 정보 쓰기는 GraduatedProfileRepository
@Injectable()
export class GraduatedCardRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT g.pk, gp.nickname, gp.company, gp.job, gp.hashtags, gp.links, u.last_active_at,
    COALESCE(c.kakao_enabled OR c.email_enabled, false) AS can_request
  FROM graduated g
  JOIN users u ON u.pk = g.user_pk
  JOIN graduated_profile gp ON gp.graduated_pk = g.pk
  LEFT JOIN coffee_chat_contact c ON c.user_pk = g.user_pk
  WHERE u.type = 'graduated' AND u.status = 'active'
    AND u.is_deleted = false AND u.withdraw_requested_at IS NULL
  ORDER BY <sort>, g.pk LIMIT ?1 OFFSET ?2;
  SELECT count(*) ... (같은 FROM · WHERE);
   */
  // 현업자 목록. 이름 · 부서 · 연락처는 select하지 않음 (비공개)
  async findPage(input: {
    sort: GraduatedCardSort;
    offset: number;
    limit: number;
    // sort = random 일 때 섞는 기준. 같은 seed면 같은 순서
    seed: string;
  }): Promise<GraduatedCardPage> {
    const db = this.dbService.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          graduatedPk: graduated.pk,
          nickname: graduatedProfile.nickname,
          company: graduatedProfile.company,
          job: graduatedProfile.job,
          hashtags: graduatedProfile.hashtags,
          links: graduatedProfile.links,
          lastActiveAt: users.lastActiveAt,
          canRequest: sql<boolean>`COALESCE(${coffeeChatContact.kakaoEnabled} OR ${coffeeChatContact.emailEnabled}, false)`,
        })
        .from(graduated)
        .innerJoin(users, eq(users.pk, graduated.userPk))
        .innerJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, graduated.pk),
        )
        .leftJoin(coffeeChatContact, eq(coffeeChatContact.userPk, users.pk))
        .where(isVisibleGraduated)
        .orderBy(...this.orderBy(input.sort, input.seed))
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({ total: count() })
        .from(graduated)
        .innerJoin(users, eq(users.pk, graduated.userPk))
        .innerJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, graduated.pk),
        )
        .where(isVisibleGraduated),
    ]);

    return { rows, total };
  }

  /*
  SELECT g.pk, u.name, c.* FROM graduated g
  JOIN users u ON u.pk = g.user_pk
  JOIN graduated_profile gp ON gp.graduated_pk = g.pk
  LEFT JOIN coffee_chat_contact c ON c.user_pk = g.user_pk
  WHERE g.pk = ?1 AND u.type = 'graduated' AND u.status = 'active'
    AND u.is_deleted = false AND u.withdraw_requested_at IS NULL;
   */
  // 커피챗 요청 대상. 목록에 보이지 않는 현업자(탈퇴 · 유예기간 · 가입 미완료)는 null
  async findRequestTarget(
    graduatedPk: string,
    tx?: TxType,
  ): Promise<GraduatedRequestTarget | null> {
    const result = await (tx ?? this.dbService.db)
      .select({
        graduatedPk: graduated.pk,
        name: users.name,
        contact: coffeeChatContact,
      })
      .from(graduated)
      .innerJoin(users, eq(users.pk, graduated.userPk))
      .innerJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, graduated.pk),
      )
      .leftJoin(coffeeChatContact, eq(coffeeChatContact.userPk, users.pk))
      .where(and(eq(graduated.pk, graduatedPk), isVisibleGraduated));

    return result[0] ?? null;
  }

  private orderBy(sort: GraduatedCardSort, seed: string): SQL[] {
    // 같은 값이 있어도 페이지 사이 순서가 흔들리지 않게 pk를 마지막 기준으로
    switch (sort) {
      case "recent_active":
        return [desc(users.lastActiveAt), asc(graduated.pk)];
      case "random":
        return [sql`md5(${graduated.pk}::text || ${seed})`, asc(graduated.pk)];
      case "recent_joined":
        // 추가 정보 입력 완료 = 가입 완료 시각
        return [desc(graduatedProfile.createdAt), asc(graduated.pk)];
    }
  }
}
