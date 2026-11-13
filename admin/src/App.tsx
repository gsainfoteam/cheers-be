import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getAccessToken } from "./lib/auth";
import { DEV_USER_DELETE_ENABLED } from "./lib/dev-user-delete";
import { AccessLogsPage } from "./pages/AccessLogsPage";
import { AdminAccountsPage } from "./pages/AdminAccountsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { BusinessCardsPage } from "./pages/BusinessCardsPage";
import { CallbackPage } from "./pages/CallbackPage";
import { CoffeeChatRequestDetailPage } from "./pages/CoffeeChatRequestDetailPage";
import { CoffeeChatRequestsPage } from "./pages/CoffeeChatRequestsPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { ConsentsPage } from "./pages/ConsentsPage";
import { DashboardLayout, PLACEHOLDER_MENUS } from "./pages/DashboardLayout";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { DevUserDeletePage } from "./pages/DevUserDeletePage";
import { HomePage } from "./pages/HomePage";
import { InterestsPage } from "./pages/InterestsPage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationLogsPage } from "./pages/NotificationLogsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

function RequireAuth({ children }: { children: ReactNode }) {
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/callback" element={<CallbackPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="consents" element={<ConsentsPage />} />
        {PLACEHOLDER_MENUS.map((menu) => (
          <Route
            key={menu.path}
            path={menu.path}
            element={<PlaceholderPage title={menu.label} />}
          />
        ))}
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="interests" element={<InterestsPage />} />
        <Route path="coffee-chats" element={<CoffeeChatRequestsPage />} />
        <Route
          path="coffee-chats/:pk"
          element={<CoffeeChatRequestDetailPage />}
        />
        <Route path="notification-logs" element={<NotificationLogsPage />} />
        <Route path="business-cards" element={<BusinessCardsPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="admin-accounts" element={<AdminAccountsPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="access-logs" element={<AccessLogsPage />} />
        {DEV_USER_DELETE_ENABLED && (
          <Route path="dev-users" element={<DevUserDeletePage />} />
        )}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
