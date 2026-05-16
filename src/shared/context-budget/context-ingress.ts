import { type ContextBudget } from "./context-budget"
import { estimateContentSize, type ContentKind } from "./context-size-estimator"

export type IngressItem = {
  id: string
  content: string
  kind?: ContentKind
  priority: number
}

export type IngressDecision = "accept" | "truncate" | "drop"

export type IngressResult = {
  id: string
  decision: IngressDecision
  originalTokens: number
  acceptedTokens: number
  acceptedContent: string
  reason: string
}

export type IngressSummary = {
  results: IngressResult[]
  totalAcceptedTokens: number
  totalOriginalTokens: number
}

function truncateToTokenBudget(content: string, kind: ContentKind | undefined, tokenBudget: number): string {
  const charBudget = tokenBudget * (kind === "code" || kind === "json" ? 3.2 : 4)
  return content.slice(0, Math.floor(charBudget))
}

export function processIngress(items: IngressItem[], budget: ContextBudget): IngressSummary {
  const sorted = [...items].sort((a, b) => b.priority - a.priority)
  const results: IngressResult[] = []
  let usedTokens = 0

  for (const item of sorted) {
    const estimate = estimateContentSize({ content: item.content, kind: item.kind })
    const remaining = budget.availableTokens - usedTokens

    if (remaining <= 0) {
      results.push({
        id: item.id,
        decision: "drop",
        originalTokens: estimate.tokens,
        acceptedTokens: 0,
        acceptedContent: "",
        reason: `no remaining budget (used ${usedTokens}/${budget.availableTokens})`,
      })
      continue
    }

    if (estimate.tokens <= remaining) {
      usedTokens += estimate.tokens
      results.push({
        id: item.id,
        decision: "accept",
        originalTokens: estimate.tokens,
        acceptedTokens: estimate.tokens,
        acceptedContent: item.content,
        reason: `${estimate.tokens} tokens fits within ${remaining} remaining`,
      })
      continue
    }

    if (remaining > 0) {
      const truncated = truncateToTokenBudget(item.content, item.kind, remaining)
      const truncatedEstimate = estimateContentSize({ content: truncated, kind: item.kind })
      usedTokens += truncatedEstimate.tokens
      results.push({
        id: item.id,
        decision: "truncate",
        originalTokens: estimate.tokens,
        acceptedTokens: truncatedEstimate.tokens,
        acceptedContent: truncated,
        reason: `truncated from ${estimate.tokens} to ${truncatedEstimate.tokens} tokens to fit remaining budget`,
      })
      continue
    }

    results.push({
      id: item.id,
      decision: "drop",
      originalTokens: estimate.tokens,
      acceptedTokens: 0,
      acceptedContent: "",
      reason: `no remaining budget (used ${usedTokens}/${budget.availableTokens})`,
    })
  }

  const totalAcceptedTokens = results.reduce((sum, r) => sum + r.acceptedTokens, 0)
  const totalOriginalTokens = results.reduce((sum, r) => sum + r.originalTokens, 0)

  return { results, totalAcceptedTokens, totalOriginalTokens }
}
