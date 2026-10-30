import { Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { interest } from "@drizzle/schema/interest";

// 기준 데이터 (seed). 조회만 함
@Injectable()
export class InterestRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT name FROM interest ORDER BY sort_order, pk;
   */
  async findAllNames(): Promise<string[]> {
    const result = await this.dbService.db
      .select({ name: interest.name })
      .from(interest)
      .orderBy(asc(interest.sortOrder), asc(interest.pk));

    return result.map((row) => row.name);
  }
}
