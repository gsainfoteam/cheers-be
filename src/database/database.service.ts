import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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

  async onModuleDestroy() {
    await this.pool.end();
  }
}
