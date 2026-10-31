import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getAccessToken } from "./lib/auth";
import { AdminAccountsPage } from "./pages/AdminAccountsPage";
import { CallbackPage } from "./pages/CallbackPage";
import { DashboardLayout, PLACEHOLDER_MENUS } from "./pages/DashboardLayout";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
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
        {PLACEHOLDER_MENUS.map((menu) => (
          <Route
            key={menu.path}
            path={menu.path}
            element={<PlaceholderPage title={menu.label} />}
          />
        ))}
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="admin-accounts" element={<AdminAccountsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
