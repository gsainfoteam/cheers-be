import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  DASHBOARD_BASE_PATH,
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGES,
  DashboardCoffeeChat,
  DashboardCoffeeChatMessage,
  DashboardCoffeeChatTrend,
  DashboardCoffeeChatTrendPoint,
  DashboardDemand,
  DashboardMember,
  DashboardMemberType,
  DashboardNameCount,
  DashboardRange,
  DashboardSignupTrend,
  DashboardSignupTrendPoint,
  DashboardTodo,
  formatCount,
  formatHours,
  formatPercent,
} from "../lib/dashboard";
import { errorMessage } from "../lib/format";

type Loaded<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

// 블록마다 따로 불러와서 하나가 느리거나 실패해도 나머지는 그대로 보임.
// 결과에 요청 경로를 같이 들고 있다가, 경로가 바뀌면(기간 변경) 다시 불러오는 중으로 취급
function useDashboard<T>(path: string): Loaded<T> {
  const [result, setResult] = useState<{
    path: string;
    state: Loaded<T>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<T>(path)
      .then(
        (data) =>
          !cancelled && setResult({ path, state: { status: "ready", data } }),
      )
      .catch(
        (err) =>
          !cancelled &&
          setResult({
            path,
            state: {
              status: "error",
              message: errorMessage(err, "불러오지 못했습니다."),
            },
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [path]);

  return result?.path === path ? result.state : { status: "loading" };
}

function Section<T>({
  title,
  hint,
  state,
  children,
}: {
  title: string;
  hint?: string;
  state: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  return (
    <section className="card dashboard-section">
      <h3>
        {title}
        {hint && <span className="dashboard-hint">{hint}</span>}
      </h3>
      {state.status === "loading" && (
        <p className="placeholder">불러오는 중…</p>
      )}
      {state.status === "error" && (
        <p className="error-text">{state.message}</p>
      )}
      {state.status === "ready" && children(state.data)}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="dashboard-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function TodoStat({
  label,
  value,
  to,
  warn,
}: {
  label: string;
  value: number;
  to?: string;
  warn?: boolean;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{formatCount(value)}</strong>
    </>
  );
  const className = `dashboard-stat${warn && value > 0 ? " dashboard-stat-warn" : ""}`;

  return to ? (
    <Link to={to} className={`${className} dashboard-stat-link`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function Bars({
  items,
  empty = "데이터가 없습니다.",
}: {
  items: { label: string; count: number }[];
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) return <p className="placeholder">{empty}</p>;

  return (
    <ul className="dashboard-bars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="dashboard-bar-label">{item.label}</span>
          <span className="dashboard-bar-track">
            <span
              className="dashboard-bar-fill"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </span>
          <span className="dashboard-bar-value">{formatCount(item.count)}</span>
        </li>
      ))}
    </ul>
  );
}

const toBars = (items: DashboardNameCount[]) =>
  items.map((item) => ({ label: item.name, count: item.count }));

function CoffeeChatSection({ range }: { range: DashboardRange }) {
  const state = useDashboard<DashboardCoffeeChat>(
    `${DASHBOARD_BASE_PATH}/coffee-chat?range=${range}`,
  );

  return (
    <Section
      title="커피챗 요청"
      hint={DASHBOARD_RANGE_LABELS[range]}
      state={state}
    >
      {({ funnel, monthly_requests }) => (
        <>
          <div className="dashboard-stats">
            <Stat label="요청" value={formatCount(funnel.requested)} />
            <Stat
              label="현업자 확인"
              value={formatCount(funnel.graduated_viewed)}
              sub={`요청 대비 ${formatPercent(funnel.rates.viewed)} · 평균 ${formatHours(funnel.avg_hours.to_viewed)}`}
            />
            <Stat
              label="연락처 공유"
              value={formatCount(funnel.contact_shared)}
              sub={`확인 대비 ${formatPercent(funnel.rates.contact_shared)} · 평균 ${formatHours(funnel.avg_hours.to_shared)}`}
            />
            <Stat
              label="재학생 확인"
              value={formatCount(funnel.student_viewed)}
            />
          </div>
          <div className="dashboard-stats">
            <TodoStat
              label="3일 넘게 미확인 (현재)"
              value={funnel.stale.unviewed_3d}
              to="/coffee-chats"
              warn
            />
            <TodoStat
              label="확인 후 3일 넘게 연락처 미공유 (현재)"
              value={funnel.stale.unshared_3d}
              to="/coffee-chats"
              warn
            />
          </div>
          <h4>월별 요청 수 (최근 6개월)</h4>
          <Bars
            items={monthly_requests.map((m) => ({
              label: m.month,
              count: m.count,
            }))}
          />
        </>
      )}
    </Section>
  );
}

function TrendTable({
  title,
  unitLabel,
  points,
}: {
  title: string;
  unitLabel: string;
  points: DashboardCoffeeChatTrendPoint[];
}) {
  // 최신이 위로 오게 뒤집어서 보여줌
  const rows = [...points].reverse();
  return (
    <div>
      <h4>{title}</h4>
      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>{unitLabel}</th>
              <th>신청</th>
              <th>공유</th>
              <th>공유율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.date}>
                <td>{p.date}</td>
                <td>{formatCount(p.requested)}</td>
                <td>{formatCount(p.contact_shared)}</td>
                <td>{formatPercent(p.share_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoffeeChatTrendSection() {
  const state = useDashboard<DashboardCoffeeChatTrend>(
    `${DASHBOARD_BASE_PATH}/coffee-chat/trend`,
  );

  return (
    <Section
      title="커피챗 신청 · 공유 추이"
      hint="일별 최근 30일 · 주별 최근 12주(월요일 시작) · 공유는 공유한 날 기준이라 공유율이 100%를 넘을 수 있음"
      state={state}
    >
      {({ daily, weekly }) => (
        <div className="dashboard-columns">
          <TrendTable title="일별" unitLabel="날짜" points={daily} />
          <TrendTable title="주별" unitLabel="주 시작일" points={weekly} />
        </div>
      )}
    </Section>
  );
}

function MessageSection({ range }: { range: DashboardRange }) {
  const state = useDashboard<DashboardCoffeeChatMessage>(
    `${DASHBOARD_BASE_PATH}/coffee-chat/message?range=${range}`,
  );

  return (
    <Section
      title="신청 메시지 길이"
      hint={DASHBOARD_RANGE_LABELS[range]}
      state={state}
    >
      {(data) => (
        <>
          <div className="dashboard-stats">
            <Stat label="메시지가 있는 신청" value={formatCount(data.count)} />
            <Stat
              label="평균 글자 수"
              value={
                data.avg_length === null ? "-" : data.avg_length.toFixed(1)
              }
            />
          </div>
          <h4>글자 수 분포</h4>
          <Bars
            items={data.histogram.map((b) => ({
              label: `${b.label}자`,
              count: b.count,
            }))}
          />
        </>
      )}
    </Section>
  );
}

function SignupTable({
  title,
  unitLabel,
  points,
}: {
  title: string;
  unitLabel: string;
  points: DashboardSignupTrendPoint[];
}) {
  const rows = [...points].reverse();
  return (
    <div>
      <h4>{title}</h4>
      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>{unitLabel}</th>
              <th>재학생</th>
              <th>현업자</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.date}>
                <td>{p.date}</td>
                <td>{formatCount(p.student)}</td>
                <td>{formatCount(p.graduated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignupTrendSection() {
  const state = useDashboard<DashboardSignupTrend>(
    `${DASHBOARD_BASE_PATH}/member/signup-trend`,
  );

  return (
    <Section
      title="신규 가입 추이"
      hint="가입 완료한 회원을 가입 시작일 기준으로 집계 · 일별 최근 30일 · 주별 최근 12주"
      state={state}
    >
      {({ daily, weekly }) => (
        <div className="dashboard-columns">
          <SignupTable title="일별" unitLabel="날짜" points={daily} />
          <SignupTable title="주별" unitLabel="주 시작일" points={weekly} />
        </div>
      )}
    </Section>
  );
}

function MemberColumn({
  title,
  member,
}: {
  title: string;
  member: DashboardMemberType;
}) {
  return (
    <div>
      <h4>{title}</h4>
      <div className="dashboard-stats">
        <Stat label="가입 완료" value={formatCount(member.active)} />
        <Stat label="가입 진행 중" value={formatCount(member.pending)} />
        <Stat label="신규 가입" value={formatCount(member.new)} />
        <Stat label="7일 내 활동" value={formatCount(member.active_7d)} />
        <Stat label="30일 내 활동" value={formatCount(member.active_30d)} />
      </div>
    </div>
  );
}

function MemberSection({ range }: { range: DashboardRange }) {
  const state = useDashboard<DashboardMember>(
    `${DASHBOARD_BASE_PATH}/member?range=${range}`,
  );

  return (
    <Section
      title="회원 현황"
      hint={`신규 가입은 ${DASHBOARD_RANGE_LABELS[range]}`}
      state={state}
    >
      {(data) => (
        <>
          <MemberColumn title="재학생" member={data.student} />
          <MemberColumn title="현업자" member={data.graduated} />
          <p className="dashboard-note">
            탈퇴 유예 중 {formatCount(data.withdraw_pending)}명
          </p>
        </>
      )}
    </Section>
  );
}

function DemandSection({ range }: { range: DashboardRange }) {
  const state = useDashboard<DashboardDemand>(
    `${DASHBOARD_BASE_PATH}/demand?range=${range}`,
  );

  return (
    <Section
      title="수요 분석"
      hint={DASHBOARD_RANGE_LABELS[range]}
      state={state}
    >
      {(data) => (
        <>
          <div className="dashboard-stats">
            <Stat
              label="요청을 받은 현업자"
              value={formatPercent(data.graduated_requested_ratio)}
              sub="가입 완료 현업자 대비"
            />
            <Stat
              label="요청을 보낸 재학생"
              value={formatPercent(data.student_requested_ratio)}
              sub="가입 완료 재학생 대비"
            />
          </div>
          <div className="dashboard-columns">
            <div>
              <h4>학과 TOP 5</h4>
              <Bars items={toBars(data.departments)} />
            </div>
            <div>
              <h4>회사 TOP 5</h4>
              <Bars items={toBars(data.companies)} />
            </div>
            <div>
              <h4>관심 분야 TOP 5</h4>
              <Bars items={toBars(data.interests)} />
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function TodoSection() {
  const state = useDashboard<DashboardTodo>(`${DASHBOARD_BASE_PATH}/todo`);

  return (
    <Section title="처리할 일" hint="현재 · 알림은 최근 7일" state={state}>
      {(data) => (
        <div className="dashboard-stats">
          <TodoStat
            label="명함 인증 대기"
            value={data.business_card_pending}
            to="/business-cards"
            warn
          />
          <TodoStat
            label="회사명 검토 필요"
            value={data.company_needs_review}
            to="/companies"
            warn
          />
          <TodoStat
            label="알림 최종 실패"
            value={data.notification.failed}
            to="/notification-logs"
            warn
          />
          <TodoStat
            label="알림 재시도 대기"
            value={data.notification.retry_waiting}
            to="/notification-logs"
          />
          <TodoStat
            label="알림톡 결과 확인 불가"
            value={data.notification.delivery_unknown}
            to="/notification-logs"
            warn
          />
        </div>
      )}
    </Section>
  );
}

export function HomePage() {
  const [range, setRange] = useState<DashboardRange>("30d");

  return (
    <>
      <div className="page-header dashboard-header">
        <h2>대시보드</h2>
        <label>
          집계 기간{" "}
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as DashboardRange)}
          >
            {DASHBOARD_RANGES.map((value) => (
              <option key={value} value={value}>
                {DASHBOARD_RANGE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TodoSection />
      <CoffeeChatSection range={range} />
      <CoffeeChatTrendSection />
      <MessageSection range={range} />
      <MemberSection range={range} />
      <SignupTrendSection />
      <DemandSection range={range} />
    </>
  );
}
