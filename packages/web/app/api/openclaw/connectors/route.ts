import { NextResponse } from "next/server"
import { badOpenClawReadRequest, getQuery } from "@/lib/openclaw-read/http"
import { readOpenClawConnectors } from "@/lib/openclaw-read/read-model"

export const runtime = "nodejs"

export function GET(request: Request): NextResponse {
  try {
    const query = getQuery(request)
    return NextResponse.json(
      readOpenClawConnectors({
        sessionId: query.get("sessionId"),
        platform: query.get("platform"),
        gateway: query.get("gateway"),
        cursor: query.get("cursor"),
        limit: query.get("limit"),
      }),
    )
  } catch (error) {
    return badOpenClawReadRequest(error)
  }
}
