import { UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK } from "../context-limit-resolver"

export type ProviderModelLimits = {
  providerID: string
  modelID: string
  contextLimit: number
}

export type BudgetDecision = "accept" | "truncate" | "drop"

export type BudgetCheckResult = {
  decision: BudgetDecision
  estimatedTokens: number
  contextLimit: number
  safetyMargin: number
  availableTokens: number
  reason: string
}

export type ContextBudgetOptions = {
  limits: ProviderModelLimits
  safetyMarginTokens?: number
}

const DEFAULT_SAFETY_MARGIN_TOKENS = 2_000

export function createContextBudget(options: ContextBudgetOptions) {
  const { limits, safetyMarginTokens = DEFAULT_SAFETY_MARGIN_TOKENS } = options
  const effectiveLimit = limits.contextLimit > 0 ? limits.contextLimit : UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK
  const availableTokens = Math.max(0, effectiveLimit - safetyMarginTokens)

  function check(estimatedTokens: number): BudgetCheckResult {
    if (estimatedTokens <= availableTokens) {
      return {
        decision: "accept",
        estimatedTokens,
        contextLimit: effectiveLimit,
        safetyMargin: safetyMarginTokens,
        availableTokens,
        reason: `${estimatedTokens} tokens fits within ${availableTokens} available`,
      }
    }

    if (estimatedTokens <= effectiveLimit) {
      return {
        decision: "truncate",
        estimatedTokens,
        contextLimit: effectiveLimit,
        safetyMargin: safetyMarginTokens,
        availableTokens,
        reason: `${estimatedTokens} tokens exceeds safety margin (${safetyMarginTokens}); truncation required`,
      }
    }

    return {
      decision: "drop",
      estimatedTokens,
      contextLimit: effectiveLimit,
      safetyMargin: safetyMarginTokens,
      availableTokens,
      reason: `${estimatedTokens} tokens exceeds hard context limit ${effectiveLimit}; content must be dropped`,
    }
  }

  return { check, availableTokens, contextLimit: effectiveLimit, safetyMargin: safetyMarginTokens }
}

export type ContextBudget = ReturnType<typeof createContextBudget>
