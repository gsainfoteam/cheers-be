type PaginationProps = {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
};

export function Pagination({ page, size, total, onChange }: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <button
        className="button secondary small"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      <span>
        {page} / {lastPage} (총 {total}건)
      </span>
      <button
        className="button secondary small"
        disabled={page >= lastPage}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </div>
  );
}
