import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getAccessToken } from "./lib/auth";
import { AdminAccountsPage } from "./pages/AdminAccountsPage";
import { BusinessCardsPage } from "./pages/BusinessCardsPage";
import { CallbackPage } from "./pages/CallbackPage";
import { CoffeeChatRequestDetailPage } from "./pages/CoffeeChatRequestDetailPage";
import { CoffeeChatRequestsPage } from "./pages/CoffeeChatRequestsPage";
import { ConsentsPage } from "./pages/ConsentsPage";
import { DashboardLayout, PLACEHOLDER_MENUS } from "./pages/DashboardLayout";
import { HomePage } from "./pages/HomePage";
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
        <Route path="coffee-chats" element={<CoffeeChatRequestsPage />} />
        <Route
          path="coffee-chats/:pk"
          element={<CoffeeChatRequestDetailPage />}
        />
        <Route path="notification-logs" element={<NotificationLogsPage />} />
        <Route path="business-cards" element={<BusinessCardsPage />} />
        <Route path="admin-accounts" element={<AdminAccountsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
