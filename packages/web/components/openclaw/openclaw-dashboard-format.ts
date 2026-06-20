export function compactDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return "-"
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat("en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed))
}

export function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

export function statusClass(status: string): string {
  switch (status) {
    case "healthy":
    case "success":
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    case "degraded":
    case "failure":
    case "failed":
    case "danger":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    case "warning":
    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300"
    default:
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
  }
}
