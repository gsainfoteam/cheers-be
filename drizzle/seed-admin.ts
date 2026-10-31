// 어드민 계정을 등록하는 스크립트. 첫 superadmin은 어드민 화면으로 만들 수 없어 이것으로 등록함
// bun run db:seed-admin -- <email>@gm.gist.ac.kr [admin|superadmin]
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { adminAccount } from "./schema/admin-account";

dotenv.config({ quiet: true });

const USAGE =
  "Usage: bun run db:seed-admin -- <email>@gm.gist.ac.kr [admin|superadmin]";

async function seedAdmin() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const roleArg = process.argv[3];

  if (
    !email.endsWith("@gm.gist.ac.kr") ||
    (roleArg !== undefined && roleArg !== "admin" && roleArg !== "superadmin")
  ) {
    console.error(USAGE);
    process.exit(1);
  }

  const role = roleArg === "admin" ? "admin" : "superadmin";

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  try {
    const inserted = await db
      .insert(adminAccount)
      .values({ pk: randomUUID(), email, role })
      .onConflictDoNothing()
      .returning({ pk: adminAccount.pk });

    console.log(
      inserted.length > 0
        ? `✅ Admin account seeded (${role}): ${email}`
        : `⏭️ Admin account already exists, left unchanged: ${email}`,
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding admin account failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedAdmin();
