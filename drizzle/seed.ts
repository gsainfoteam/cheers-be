// drizzle/seed.ts
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { school } from "./schema/school";
import { department } from "./schema/department";

// .env 파일 로드
dotenv.config({ quiet: true });

// 학교 / 학과 기준 데이터. pk는 한 번 정하면 바꾸지 않음 (student_profile 이 참조)
// 이름을 고치면 같은 pk 행의 name 만 바뀜. 목록에서 빼도 DB 행은 지우지 않음
const GIST = 1;

const SCHOOLS: (typeof school.$inferInsert)[] = [
  { pk: GIST, name: "GIST", emailDomain: "gm.gist.ac.kr" },
];

// 출처: GIST 홈페이지 교육 > 대학·학과 메뉴 (2026-10-25 확인)
const DEPARTMENTS: (typeof department.$inferInsert)[] = [
  { pk: 1, schoolPk: GIST, name: "기초교육학부" }, // 전공 선택 전
  { pk: 2, schoolPk: GIST, name: "AI학과" },
  { pk: 3, schoolPk: GIST, name: "AX학과" },
  { pk: 4, schoolPk: GIST, name: "물리·광과학과" },
  { pk: 5, schoolPk: GIST, name: "화학과" },
  { pk: 6, schoolPk: GIST, name: "생명과학과" },
  { pk: 7, schoolPk: GIST, name: "수리과학과" },
  { pk: 8, schoolPk: GIST, name: "전기전자컴퓨터공학과" },
  { pk: 9, schoolPk: GIST, name: "기계로봇공학과" },
  { pk: 10, schoolPk: GIST, name: "신소재공학과" },
  { pk: 11, schoolPk: GIST, name: "환경·에너지공학과" },
  { pk: 12, schoolPk: GIST, name: "반도체공학과" },
  { pk: 13, schoolPk: GIST, name: "의생명공학과" },
  { pk: 14, schoolPk: GIST, name: "융합신경생리학과" },
];

async function runSeed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  console.log("⏳ Seeding school / department...");

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(school)
        .values(SCHOOLS)
        .onConflictDoUpdate({
          target: school.pk,
          set: {
            name: sql`excluded.name`,
            emailDomain: sql`excluded.email_domain`,
          },
        });

      await tx
        .insert(department)
        .values(DEPARTMENTS)
        .onConflictDoUpdate({
          target: department.pk,
          set: {
            schoolPk: sql`excluded.school_pk`,
            name: sql`excluded.name`,
          },
        });
    });
    console.log("✅ Seed completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSeed();
