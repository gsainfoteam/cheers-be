import { useCurrentManager } from "../lib/current-manager";

export function HomePage() {
  const me = useCurrentManager();

  return (
    <>
      <div className="page-header">
        <h2>홈</h2>
      </div>
      <div className="card">
        <p>
          {me.email} ({me.role})
        </p>
      </div>
    </>
  );
}
