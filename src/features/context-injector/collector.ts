import type {
  BudgetedPendingContext,
  ContextEntry,
  ContextPriority,
  PendingContext,
  RegisterContextOptions,
} from "./types"
import { processIngress } from "../../shared/context-budget"
import type { ContextBudget } from "../../shared/context-budget"

const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const PRIORITY_INGRESS_WEIGHT: Record<ContextPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

const CONTEXT_SEPARATOR = "\n\n---\n\n"

let registrationCounter = 0

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()

  register(sessionID: string, options: RegisterContextOptions): void {
    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Map())
    }

    const sessionMap = this.sessions.get(sessionID)!
    const key = `${options.source}:${options.id}`

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? "normal",
      registrationOrder: ++registrationCounter,
      metadata: options.metadata,
    }

    sessionMap.set(key, entry)
  }

  getPending(sessionID: string): PendingContext {
    const sessionMap = this.sessions.get(sessionID)

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: "",
        entries: [],
        hasContent: false,
      }
    }

    const entries = this.sortEntries([...sessionMap.values()])
    const merged = entries.map((e) => e.content).join(CONTEXT_SEPARATOR)

    return {
      merged,
      entries,
      hasContent: entries.length > 0,
    }
  }

  getBudgetedPending(sessionID: string, budget: ContextBudget): BudgetedPendingContext {
    const sessionMap = this.sessions.get(sessionID)

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: "",
        acceptedEntries: [],
        hasContent: false,
        ingressResults: [],
      }
    }

    const entries = this.sortEntries([...sessionMap.values()])

    const ingressItems = entries.map((entry) => ({
      id: `${entry.source}:${entry.id}`,
      content: entry.content,
      priority: PRIORITY_INGRESS_WEIGHT[entry.priority],
    }))

    const summary = processIngress(ingressItems, budget)

    const acceptedIds = new Set(
      summary.results.filter((r) => r.decision === "accept").map((r) => r.id)
    )

    const acceptedEntries = entries.filter((e) => acceptedIds.has(`${e.source}:${e.id}`))

    const acceptedContents = summary.results
      .filter((r) => r.acceptedContent.length > 0)
      .map((r) => r.acceptedContent)

    const merged = acceptedContents.join(CONTEXT_SEPARATOR)

    return {
      merged,
      acceptedEntries,
      hasContent: merged.length > 0,
      ingressResults: summary.results,
    }
  }

  consume(sessionID: string): PendingContext {
    const pending = this.getPending(sessionID)
    this.clear(sessionID)
    return pending
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  clearAll(): void {
    this.sessions.clear()
  }

  hasPending(sessionID: string): boolean {
    const sessionMap = this.sessions.get(sessionID)
    return sessionMap !== undefined && sessionMap.size > 0
  }

  private sortEntries(entries: ContextEntry[]): ContextEntry[] {
    return entries.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.registrationOrder - b.registrationOrder
    })
  }
}

export const contextCollector = new ContextCollector()
