// 개발용 가짜 데이터를 넣는 스크립트 (로컬 · staging). 개발용 데이터만 지우고 다시 넣으므로 반복 실행해도 됨
// bun run db:seed:dev
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { seedDevData, uploadDevBusinessCards } from "./seed-dev-data";

dotenv.config({ quiet: true });

// 차단은 하지 않으므로 어느 DB에 넣는지 보여 줌. 비밀번호는 출력하지 않음
function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || 5432}${pathname}`;
}

async function seedDev() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  try {
    console.log(
      `⏳ Seeding dev data into ${describeDatabase(process.env.DATABASE_URL)}`,
    );
    const result = await seedDevData(db);
    console.log(
      `✅ Dev data seeded: ${result.users} users, ${result.coffeeChatRequests} coffee chat requests`,
    );

    const { uploaded, error } = await uploadDevBusinessCards(
      result.businessCardKeys,
    );
    if (error) {
      console.warn(
        `⚠️ Uploaded ${uploaded}/${result.businessCardKeys.length} business cards, the rest will return 404: ${error}`,
      );
    } else {
      console.log(
        `✅ Uploaded ${uploaded} business cards to ${process.env.AWS_S3_BUCKET_NAME}`,
      );
    }
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding dev data failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedDev();
