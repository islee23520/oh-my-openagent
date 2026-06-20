import { NextResponse } from "next/server"
import { badOpenClawReadRequest, getQuery } from "@/lib/openclaw-read/http"
import { readOpenClawLedger } from "@/lib/openclaw-read/read-model"

export const runtime = "nodejs"

export function GET(request: Request): NextResponse {
  try {
    const query = getQuery(request)
    return NextResponse.json(
      readOpenClawLedger({
        sessionId: query.get("sessionId"),
        runId: query.get("runId"),
        openclawEvent: query.get("openclawEvent"),
        status: query.get("status"),
        cursor: query.get("cursor"),
        limit: query.get("limit"),
      }),
    )
  } catch (error) {
    return badOpenClawReadRequest(error)
  }
}
