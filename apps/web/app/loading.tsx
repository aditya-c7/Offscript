export default function Loading() {
  return (
    <div
      className="animate-pulse space-y-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <div
            key={key}
            className="h-64 rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
