import { NextResponse } from "next/server"
import { badOpenClawReadRequest, getQuery } from "@/lib/openclaw-read/http"
import { readOpenClawSessions } from "@/lib/openclaw-read/read-model"

export const runtime = "nodejs"

export function GET(request: Request): NextResponse {
  try {
    const query = getQuery(request)
    return NextResponse.json(
      readOpenClawSessions({
        sessionId: query.get("sessionId"),
        cursor: query.get("cursor"),
        limit: query.get("limit"),
      }),
    )
  } catch (error) {
    return badOpenClawReadRequest(error)
  }
}
