import type { PageInput, PageResult } from "./types"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export class InvalidCursorError extends Error {
  constructor(readonly cursor: string) {
    super(`Invalid OpenClaw cursor: ${cursor}`)
    this.name = "InvalidCursorError"
  }
}

export class InvalidLimitError extends Error {
  constructor(readonly limit: string) {
    super(`Invalid OpenClaw limit: ${limit}`)
    this.name = "InvalidLimitError"
  }
}

function parseOffset(cursor: string | null): number {
  if (cursor === null || cursor === "") return 0
  if (!/^\d+$/.test(cursor)) throw new InvalidCursorError(cursor)
  return Number.parseInt(cursor, 10)
}

function parseLimit(limit: string | null): number {
  if (limit === null || limit === "") return DEFAULT_LIMIT
  if (!/^\d+$/.test(limit)) throw new InvalidLimitError(limit)
  const parsed = Number.parseInt(limit, 10)
  if (parsed < 1 || parsed > MAX_LIMIT) throw new InvalidLimitError(limit)
  return parsed
}

export function paginate<T>(items: readonly T[], input: PageInput): PageResult<T> {
  const offset = parseOffset(input.cursor)
  const limit = parseLimit(input.limit)
  const data = items.slice(offset, offset + limit)
  const nextOffset = offset + data.length
  return {
    data,
    page: {
      limit,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
      total: items.length,
    },
  }
}
