import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearAccessToken } from "../lib/auth";
import { CurrentManagerProvider } from "../lib/current-manager";

// 메뉴 자리만 둠. 기능은 각 하위 이슈에서 추가
export const PLACEHOLDER_MENUS = [
  { path: "consents", label: "이용약관" },
  { path: "departments", label: "학과" },
  { path: "business-cards", label: "현업자 명함" },
  { path: "coffee-chats", label: "커피챗 요청" },
  { path: "interests", label: "관심분야" },
];

const NAV_ITEMS = [
  { to: "/", label: "홈", end: true },
  ...PLACEHOLDER_MENUS.map((menu) => ({
    to: `/${menu.path}`,
    label: menu.label,
    end: false,
  })),
  { to: "/admin-accounts", label: "어드민 계정", end: false },
];

export function DashboardLayout() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">Cheers Admin</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="button secondary"
          onClick={() => {
            clearAccessToken();
            navigate("/login", { replace: true });
          }}
        >
          로그아웃
        </button>
      </aside>
      <main className="main">
        <CurrentManagerProvider>
          <Outlet />
        </CurrentManagerProvider>
      </main>
    </div>
  );
}
