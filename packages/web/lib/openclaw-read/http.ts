import { NextResponse } from "next/server"
import { InvalidCursorError, InvalidLimitError } from "./read-model"

interface OpenClawReadError {
  readonly error: {
    readonly code: "invalid_cursor" | "invalid_limit" | "internal_error"
    readonly message: string
  }
}

export function badOpenClawReadRequest(error: unknown): NextResponse<OpenClawReadError> {
  if (error instanceof InvalidCursorError) {
    return NextResponse.json(
      {
        error: { code: "invalid_cursor", message: "cursor must be a non-negative integer offset" },
      },
      { status: 400 },
    )
  }
  if (error instanceof InvalidLimitError) {
    return NextResponse.json(
      { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 100" } },
      { status: 400 },
    )
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "OpenClaw read API failed" } },
    { status: 500 },
  )
}

export function getQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams
}
