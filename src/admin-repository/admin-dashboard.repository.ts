import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";

export type AdminDashboardFunnel = {
  requested: number;
  graduatedViewed: number;
  accepted: number;
  contactShared: number;
  studentViewed: number;
  // 단계 사이 평균 소요시간(시간). 해당 단계에 도달한 요청이 없으면 null
  hoursToViewed: number | null;
  hoursToAccepted: number | null;
  hoursToShared: number | null;
};

export type AdminDashboardStale = {
  unviewed: number;
  unaccepted: number;
};

export type AdminDashboardMonthlyRequest = { month: string; count: number };

export type AdminDashboardMemberRow = {
  type: "student" | "graduated";
  active: number;
  pending: number;
  newActive: number;
  active7d: number;
  active30d: number;
};

export type AdminDashboardNameCount = { name: string; count: number };

export type AdminDashboardRequesterCounts = {
  requestedGraduated: number;
  requestedStudent: number;
  activeGraduated: number;
  activeStudent: number;
};

export type AdminDashboardNotificationCounts = {
  failed: number;
  retryWaiting: number;
  deliveryUnknown: number;
};

// 대시보드 집계 전용 읽기 쿼리. 모두 SELECT이고 서로 독립이라 서비스에서 동시에 호출함.
// 탈퇴한 회원(users.is_deleted)은 회원 · 처리할 일 집계에서 제외하고,
// 커피챗 요청은 이력이라 요청한 사람이 탈퇴해도 그대로 셈
@Injectable()
export class AdminDashboardRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT count(*), count(graduated_viewed_at), count(accepted_at), count(contact_shared_at), count(student_viewed_at),
    avg(graduated_viewed_at - created_at), avg(accepted_at - graduated_viewed_at), avg(contact_shared_at - accepted_at)
  FROM coffee_chat_request WHERE created_at >= ?1;
   */
  async coffeeChatFunnel(from: Date): Promise<AdminDashboardFunnel> {
    const result = await this.dbService.db.execute<{
      requested: number;
      graduated_viewed: number;
      accepted: number;
      contact_shared: number;
      student_viewed: number;
      hours_to_viewed: number | null;
      hours_to_accepted: number | null;
      hours_to_shared: number | null;
    }>(sql`
      SELECT
        COUNT(*)::int AS requested,
        COUNT(graduated_viewed_at)::int AS graduated_viewed,
        COUNT(accepted_at)::int AS accepted,
        COUNT(contact_shared_at)::int AS contact_shared,
        COUNT(student_viewed_at)::int AS student_viewed,
        (AVG(EXTRACT(EPOCH FROM graduated_viewed_at - created_at)) / 3600)::float8 AS hours_to_viewed,
        (AVG(EXTRACT(EPOCH FROM accepted_at - graduated_viewed_at)) / 3600)::float8 AS hours_to_accepted,
        (AVG(EXTRACT(EPOCH FROM contact_shared_at - accepted_at)) / 3600)::float8 AS hours_to_shared
      FROM coffee_chat_request
      WHERE created_at >= ${from}
    `);
    const row = result.rows[0];

    return {
      requested: row.requested,
      graduatedViewed: row.graduated_viewed,
      accepted: row.accepted,
      contactShared: row.contact_shared,
      studentViewed: row.student_viewed,
      hoursToViewed: row.hours_to_viewed,
      hoursToAccepted: row.hours_to_accepted,
      hoursToShared: row.hours_to_shared,
    };
  }

  /*
  SELECT count(*) FILTER (WHERE graduated_viewed_at IS NULL AND created_at < ?1),
         count(*) FILTER (WHERE graduated_viewed_at < ?1 AND accepted_at IS NULL)
  FROM coffee_chat_request;
   */
  async staleRequests(staleBefore: Date): Promise<AdminDashboardStale> {
    const result = await this.dbService.db.execute<{
      unviewed: number;
      unaccepted: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE graduated_viewed_at IS NULL AND created_at < ${staleBefore})::int AS unviewed,
        COUNT(*) FILTER (WHERE graduated_viewed_at < ${staleBefore} AND accepted_at IS NULL)::int AS unaccepted
      FROM coffee_chat_request
    `);

    return result.rows[0];
  }

  /*
  SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month, count(*)
  FROM coffee_chat_request WHERE created_at >= ?1 GROUP BY 1 ORDER BY 1;
   */
  async monthlyRequests(from: Date): Promise<AdminDashboardMonthlyRequest[]> {
    const result =
      await this.dbService.db.execute<AdminDashboardMonthlyRequest>(
        sql`
        SELECT
          to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month,
          COUNT(*)::int AS count
        FROM coffee_chat_request
        WHERE created_at >= ${from}
        GROUP BY 1
        ORDER BY 1
      `,
      );

    return result.rows;
  }

  /*
  SELECT type,
    count(*) FILTER (WHERE status = 'active'), count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'active' AND created_at >= ?1),
    count(*) FILTER (WHERE last_active_at >= ?2), count(*) FILTER (WHERE last_active_at >= ?3)
  FROM users WHERE NOT is_deleted GROUP BY type;
   */
  async memberStats(
    newFrom: Date,
    active7dFrom: Date,
    active30dFrom: Date,
  ): Promise<AdminDashboardMemberRow[]> {
    const result = await this.dbService.db.execute<{
      type: "student" | "graduated";
      active: number;
      pending: number;
      new_active: number;
      active_7d: number;
      active_30d: number;
    }>(sql`
      SELECT
        type,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'active' AND created_at >= ${newFrom})::int AS new_active,
        COUNT(*) FILTER (WHERE status = 'active' AND last_active_at >= ${active7dFrom})::int AS active_7d,
        COUNT(*) FILTER (WHERE status = 'active' AND last_active_at >= ${active30dFrom})::int AS active_30d
      FROM users
      WHERE NOT is_deleted
      GROUP BY type
    `);

    return result.rows.map((row) => ({
      type: row.type,
      active: row.active,
      pending: row.pending,
      newActive: row.new_active,
      active7d: row.active_7d,
      active30d: row.active_30d,
    }));
  }

  // 탈퇴 요청 후 유예기간 중인 회원 (아직 is_deleted가 아님)
  async countWithdrawPending(): Promise<number> {
    const result = await this.dbService.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE NOT is_deleted AND withdraw_requested_at IS NOT NULL
    `);

    return result.rows[0].count;
  }

  /*
  SELECT d.name, count(*) FROM coffee_chat_request r
  JOIN student_profile sp ON sp.pk = r.student_profile_pk JOIN department d ON d.pk = sp.department_pk
  WHERE r.created_at >= ?1 GROUP BY d.pk, d.name ORDER BY count DESC, d.name LIMIT ?2;
   */
  async topDepartments(
    from: Date,
    limit: number,
  ): Promise<AdminDashboardNameCount[]> {
    const result = await this.dbService.db.execute<AdminDashboardNameCount>(sql`
      SELECT d.name AS name, COUNT(*)::int AS count
      FROM coffee_chat_request r
      JOIN student_profile sp ON sp.pk = r.student_profile_pk
      JOIN department d ON d.pk = sp.department_pk
      WHERE r.created_at >= ${from}
      GROUP BY d.pk, d.name
      ORDER BY count DESC, d.name
      LIMIT ${limit}
    `);

    return result.rows;
  }

  /*
  SELECT ca.name, count(*) FROM coffee_chat_request r
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk JOIN company_alias ca ON ca.pk = gp.company_alias_pk
  WHERE r.created_at >= ?1 GROUP BY ca.pk, ca.name ORDER BY count DESC, ca.name LIMIT ?2;
   */
  async topCompanies(
    from: Date,
    limit: number,
  ): Promise<AdminDashboardNameCount[]> {
    const result = await this.dbService.db.execute<AdminDashboardNameCount>(sql`
      SELECT ca.name AS name, COUNT(*)::int AS count
      FROM coffee_chat_request r
      JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
      JOIN company_alias ca ON ca.pk = gp.company_alias_pk
      WHERE r.created_at >= ${from}
      GROUP BY ca.pk, ca.name
      ORDER BY count DESC, ca.name
      LIMIT ${limit}
    `);

    return result.rows;
  }

  /*
  SELECT i AS name, count(*) FROM coffee_chat_request r
  JOIN student_profile sp ON sp.pk = r.student_profile_pk
  CROSS JOIN LATERAL unnest(sp.interests) AS i
  WHERE r.created_at >= ?1 GROUP BY i ORDER BY count DESC, i LIMIT ?2;
   */
  async topInterests(
    from: Date,
    limit: number,
  ): Promise<AdminDashboardNameCount[]> {
    const result = await this.dbService.db.execute<AdminDashboardNameCount>(sql`
      SELECT i AS name, COUNT(*)::int AS count
      FROM coffee_chat_request r
      JOIN student_profile sp ON sp.pk = r.student_profile_pk
      CROSS JOIN LATERAL unnest(sp.interests) AS i
      WHERE r.created_at >= ${from}
      GROUP BY i
      ORDER BY count DESC, i
      LIMIT ${limit}
    `);

    return result.rows;
  }

  /*
  SELECT count(DISTINCT graduated_pk), count(DISTINCT student_pk) FROM coffee_chat_request WHERE created_at >= ?1;
  SELECT count(*) FILTER (WHERE type = 'graduated'), count(*) FILTER (WHERE type = 'student')
  FROM users WHERE status = 'active' AND NOT is_deleted;
   */
  async requesterCounts(from: Date): Promise<AdminDashboardRequesterCounts> {
    const result = await this.dbService.db.execute<{
      requested_graduated: number;
      requested_student: number;
      active_graduated: number;
      active_student: number;
    }>(sql`
      SELECT
        (SELECT COUNT(DISTINCT graduated_pk) FROM coffee_chat_request WHERE created_at >= ${from})::int AS requested_graduated,
        (SELECT COUNT(DISTINCT student_pk) FROM coffee_chat_request WHERE created_at >= ${from})::int AS requested_student,
        (SELECT COUNT(*) FROM users WHERE type = 'graduated' AND status = 'active' AND NOT is_deleted)::int AS active_graduated,
        (SELECT COUNT(*) FROM users WHERE type = 'student' AND status = 'active' AND NOT is_deleted)::int AS active_student
    `);
    const row = result.rows[0];

    return {
      requestedGraduated: row.requested_graduated,
      requestedStudent: row.requested_student,
      activeGraduated: row.active_graduated,
      activeStudent: row.active_student,
    };
  }

  /*
  SELECT count(*) FROM graduated g JOIN users u ON u.pk = g.user_pk
  WHERE g.business_card_key IS NOT NULL AND g.verified_at IS NULL AND NOT u.is_deleted;
   */
  async countBusinessCardPending(): Promise<number> {
    const result = await this.dbService.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM graduated g
      JOIN users u ON u.pk = g.user_pk
      WHERE g.business_card_key IS NOT NULL
        AND g.verified_at IS NULL
        AND NOT u.is_deleted
    `);

    return result.rows[0].count;
  }

  // SELECT count(*) FROM company_alias WHERE needs_review;
  async countCompanyNeedsReview(): Promise<number> {
    const result = await this.dbService.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM company_alias WHERE needs_review
    `);

    return result.rows[0].count;
  }

  /*
  SELECT count(*) FILTER (WHERE status = 'failed' AND next_retry_at IS NULL),
         count(*) FILTER (WHERE next_retry_at IS NOT NULL),
         count(*) FILTER (WHERE delivery_status = 'unknown')
  FROM notification_log WHERE created_at >= ?1;
   */
  async notificationCounts(
    since: Date,
  ): Promise<AdminDashboardNotificationCounts> {
    const result = await this.dbService.db.execute<{
      failed: number;
      retry_waiting: number;
      delivery_unknown: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'failed' AND next_retry_at IS NULL)::int AS failed,
        COUNT(*) FILTER (WHERE next_retry_at IS NOT NULL)::int AS retry_waiting,
        COUNT(*) FILTER (WHERE delivery_status = 'unknown')::int AS delivery_unknown
      FROM notification_log
      WHERE created_at >= ${since}
    `);
    const row = result.rows[0];

    return {
      failed: row.failed,
      retryWaiting: row.retry_waiting,
      deliveryUnknown: row.delivery_unknown,
    };
  }
}
