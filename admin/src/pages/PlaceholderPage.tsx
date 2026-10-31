export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <div className="page-header">
        <h2>{title}</h2>
      </div>
      <div className="card">
        <p className="placeholder">준비 중입니다.</p>
      </div>
    </>
  );
}
