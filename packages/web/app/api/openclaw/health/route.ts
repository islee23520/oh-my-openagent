import { NextResponse } from "next/server"
import { readOpenClawHealth } from "@/lib/openclaw-read/read-model"

export const runtime = "nodejs"

export function GET(): NextResponse {
  return NextResponse.json(readOpenClawHealth())
}
