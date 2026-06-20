"use client"

import type { JSX } from "react"
import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { loadOpenClawDashboardData } from "./openclaw-dashboard-data"
import { DashboardBody, ErrorState, LoadingState } from "./openclaw-dashboard-panels"
import type { DashboardCopy, DashboardData } from "./openclaw-dashboard-types"

interface OpenClawDashboardProps {
  readonly copy: DashboardCopy
  readonly initialSessionId: string
  readonly forceApiError: boolean
  readonly forceInvalidEnvelope: boolean
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly data: DashboardData }
  | { readonly kind: "error"; readonly message: string }

export function OpenClawDashboard({
  copy,
  initialSessionId,
  forceApiError,
  forceInvalidEnvelope,
}: OpenClawDashboardProps): JSX.Element {
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const normalizedSessionId = useMemo(() => sessionId.trim(), [sessionId])

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    void loadOpenClawDashboardData(normalizedSessionId, forceApiError, forceInvalidEnvelope)
      .then((data) => {
        if (!cancelled) setState({ kind: "loaded", data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : copy.errorBody
        setState({ kind: "error", message })
      })
    return () => {
      cancelled = true
    }
  }, [copy.errorBody, forceApiError, forceInvalidEnvelope, normalizedSessionId, reloadKey])

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-zinc-100">
      <div className="container mx-auto max-w-7xl px-4 py-10 md:px-6 md:py-12">
        <header className="grid gap-6 border-b border-zinc-800 pb-8 lg:grid-cols-[1fr_420px] lg:items-end">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.12em] text-cyan-300 uppercase">
              {copy.eyebrow}
            </p>
            <h1 className="mt-4 max-w-[760px] text-4xl leading-tight font-bold tracking-tight text-zinc-50 md:text-5xl">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-[760px] text-base leading-7 text-zinc-400">
              {copy.description}
            </p>
          </div>
          <form
            className="grid gap-3 border border-zinc-800 bg-zinc-950/60 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              setReloadKey((value) => value + 1)
            }}
          >
            <label
              className="text-xs font-medium tracking-[0.08em] text-zinc-500 uppercase"
              htmlFor="sessionId"
            >
              {copy.sessionFilterLabel}
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                id="sessionId"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className="h-11 border-zinc-700 bg-black/40 font-mono text-sm text-zinc-100"
                placeholder="qa-session-10"
              />
              <Button
                type="submit"
                className="h-11 bg-cyan-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-cyan-300"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {copy.refresh}
              </Button>
            </div>
          </form>
        </header>

        <main className="mt-8">
          {state.kind === "loading" ? <LoadingState copy={copy} /> : null}
          {state.kind === "error" ? <ErrorState copy={copy} message={state.message} /> : null}
          {state.kind === "loaded" ? <DashboardBody data={state.data} copy={copy} /> : null}
        </main>
      </div>
    </div>
  )
}
