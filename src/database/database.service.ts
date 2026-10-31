import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, QueryConfig } from "pg";
import { ConfigService } from "@nestjs/config";
import { DefaultLogger } from "drizzle-orm";
import { QueryLogWriter } from "@src/database/query.log.writer";
import { LoggerService } from "@src/global/logger/logger.service";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  public readonly db: ReturnType<typeof drizzle>;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>("DATABASE_URL"),
    });
    // 쉬고 있는 연결이 끊기면 pool이 error를 내보냄. 리스너가 없으면 Node에서는 프로세스가 죽음.
    // 끊긴 연결은 pool이 버리고 다음 쿼리에서 새로 연결함
    this.pool.on("error", (error) => {
      this.logger.warn(`Idle database connection error: ${error.message}`);
    });
    this.db = drizzle(this.pool, {
      logger: new DefaultLogger({
        writer: new QueryLogWriter(loggerService),
      }),
    });
  }

  async onModuleInit() {
    try {
      const client = await this.pool.connect();
      client.release();
      this.logger.log("Database connection established successfully");
    } catch (error) {
      this.logger.error("Failed to connect to the database:", error);
      throw error;
    }
  }

  // readiness 확인용. drizzle을 거치지 않아 쿼리 로그가 남지 않음.
  // query_timeout은 pool에서 연결을 기다리는 시간을 포함하지 않아 타이머로도 제한함
  async ping(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Database ping timed out (${timeoutMs}ms)`)),
        timeoutMs,
      );
    });

    // @types/pg에 없지만 pg는 쿼리별 query_timeout을 지원함
    const query: QueryConfig & { query_timeout: number } = {
      text: "SELECT 1",
      query_timeout: timeoutMs,
    };

    try {
      await Promise.race([this.pool.query(query), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
