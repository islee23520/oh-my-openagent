import { describe, expect, it } from "bun:test"
import { createContextBudget } from "./context-budget"

describe("createContextBudget", () => {
  describe("#check", () => {
    it("returns accept when estimated tokens fit within available budget", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "openai", modelID: "gpt-5", contextLimit: 10_000 },
        safetyMarginTokens: 1_000,
      })

      // when
      const result = budget.check(5_000)

      // then
      expect(result.decision).toBe("accept")
      expect(result.availableTokens).toBe(9_000)
      expect(result.reason).toContain("fits within")
    })

    it("returns truncate when tokens exceed safety margin but not hard limit", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "openai", modelID: "gpt-5", contextLimit: 10_000 },
        safetyMarginTokens: 1_000,
      })

      // when
      const result = budget.check(9_500)

      // then
      expect(result.decision).toBe("truncate")
      expect(result.reason).toContain("safety margin")
    })

    it("returns drop when tokens exceed hard context limit", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "openai", modelID: "gpt-5", contextLimit: 10_000 },
        safetyMarginTokens: 1_000,
      })

      // when
      const result = budget.check(11_000)

      // then
      expect(result.decision).toBe("drop")
      expect(result.reason).toContain("hard context limit")
    })

    it("uses default safety margin of 2000 tokens when not specified", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "anthropic", modelID: "claude-sonnet-4-5", contextLimit: 200_000 },
      })

      // when / then
      expect(budget.safetyMargin).toBe(2_000)
      expect(budget.availableTokens).toBe(198_000)
    })

    it("falls back to UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK when contextLimit is zero", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "unknown", modelID: "unknown-model", contextLimit: 0 },
        safetyMarginTokens: 0,
      })

      // when / then
      expect(budget.contextLimit).toBe(32_000)
    })

    it("exposes contextLimit, availableTokens, and safetyMargin on the returned object", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "openai", modelID: "gpt-5", contextLimit: 50_000 },
        safetyMarginTokens: 500,
      })

      // when / then
      expect(budget.contextLimit).toBe(50_000)
      expect(budget.availableTokens).toBe(49_500)
      expect(budget.safetyMargin).toBe(500)
    })

    it("includes structured metadata in every result", () => {
      // given
      const budget = createContextBudget({
        limits: { providerID: "openai", modelID: "gpt-5", contextLimit: 10_000 },
        safetyMarginTokens: 1_000,
      })

      // when
      const result = budget.check(3_000)

      // then
      expect(result.estimatedTokens).toBe(3_000)
      expect(result.contextLimit).toBe(10_000)
      expect(result.safetyMargin).toBe(1_000)
      expect(result.availableTokens).toBe(9_000)
    })
  })
})
