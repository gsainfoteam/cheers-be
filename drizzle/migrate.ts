// scripts/migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { existsSync } from "node:fs";
import * as dotenv from "dotenv";

// .env 파일 로드
dotenv.config({ quiet: true });

const MIGRATIONS_FOLDER = "./drizzle";

async function runMigration() {
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    // 아직 `bun run db:generate` 로 생성된 마이그레이션이 없는 경우
    console.log("⏭️ No migrations found, skipping");
    process.exit(0);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  console.log("⏳ Running migrations...");

  try {
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "public",
    });
    console.log("✅ Migrations completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
