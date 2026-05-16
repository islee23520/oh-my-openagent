import { describe, expect, it } from "bun:test"
import { processIngress } from "./context-ingress"
import { createContextBudget } from "./context-budget"

function makeBudget(contextLimit: number, safetyMarginTokens = 0) {
  return createContextBudget({
    limits: { providerID: "openai", modelID: "gpt-5", contextLimit },
    safetyMarginTokens,
  })
}

describe("processIngress", () => {
  it("accepts all items when total tokens fit within budget", () => {
    // given
    const budget = makeBudget(10_000)
    const items = [
      { id: "a", content: "a".repeat(40), priority: 1 },
      { id: "b", content: "b".repeat(40), priority: 2 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    expect(summary.results.every((r) => r.decision === "accept")).toBe(true)
    expect(summary.results.find((r) => r.id === "a")?.decision).toBe("accept")
    expect(summary.results.find((r) => r.id === "b")?.decision).toBe("accept")
  })

  it("processes items in descending priority order", () => {
    // given
    const budget = makeBudget(10)
    const items = [
      { id: "low", content: "a".repeat(40), priority: 1 },
      { id: "high", content: "b".repeat(40), priority: 10 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    const highResult = summary.results.find((r) => r.id === "high")
    const lowResult = summary.results.find((r) => r.id === "low")
    expect(highResult?.decision).toBe("accept")
    expect(lowResult?.decision).toBe("drop")
  })

  it("truncates an item when it partially fits within remaining budget", () => {
    // given
    const budget = makeBudget(20, 0)
    const items = [
      { id: "big", content: "a".repeat(200), priority: 1 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    const result = summary.results[0]
    expect(result.decision).toBe("truncate")
    expect(result.acceptedTokens).toBeLessThan(result.originalTokens)
    expect(result.acceptedTokens).toBeGreaterThan(0)
  })

  it("drops items when no budget remains", () => {
    // given
    const budget = makeBudget(10)
    const items = [
      { id: "first", content: "a".repeat(80), priority: 10 },
      { id: "second", content: "b".repeat(40), priority: 1 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    const secondResult = summary.results.find((r) => r.id === "second")
    expect(secondResult?.decision).toBe("drop")
    expect(secondResult?.acceptedTokens).toBe(0)
  })

  it("returns correct totalAcceptedTokens and totalOriginalTokens", () => {
    // given
    const budget = makeBudget(10_000)
    const items = [
      { id: "a", content: "a".repeat(40), priority: 1 },
      { id: "b", content: "b".repeat(40), priority: 2 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    expect(summary.totalOriginalTokens).toBe(20)
    expect(summary.totalAcceptedTokens).toBe(20)
  })

  it("returns empty summary for empty items array", () => {
    // given
    const budget = makeBudget(10_000)

    // when
    const summary = processIngress([], budget)

    // then
    expect(summary.results).toHaveLength(0)
    expect(summary.totalAcceptedTokens).toBe(0)
    expect(summary.totalOriginalTokens).toBe(0)
  })

  it("includes reason string in every result", () => {
    // given
    const budget = makeBudget(10_000)
    const items = [{ id: "x", content: "hello world", priority: 1 }]

    // when
    const summary = processIngress(items, budget)

    // then
    expect(summary.results[0].reason.length).toBeGreaterThan(0)
  })

  it("accepted item has acceptedContent equal to original content", () => {
    // given
    const budget = makeBudget(10_000)
    const content = "hello world this is accepted content"
    const items = [{ id: "a", content, priority: 1 }]

    // when
    const summary = processIngress(items, budget)

    // then
    const result = summary.results[0]
    expect(result.decision).toBe("accept")
    expect(result.acceptedContent).toBe(content)
  })

  it("truncated item has acceptedContent shorter than original", () => {
    // given
    const budget = makeBudget(20, 0)
    const content = "a".repeat(200)
    const items = [{ id: "big", content, priority: 1 }]

    // when
    const summary = processIngress(items, budget)

    // then
    const result = summary.results[0]
    expect(result.decision).toBe("truncate")
    expect(result.acceptedContent.length).toBeLessThan(content.length)
    expect(result.acceptedContent.length).toBeGreaterThan(0)
    expect(content.startsWith(result.acceptedContent)).toBe(true)
  })

  it("dropped item has empty acceptedContent", () => {
    // given
    const budget = makeBudget(10)
    const items = [
      { id: "first", content: "a".repeat(80), priority: 10 },
      { id: "second", content: "b".repeat(40), priority: 1 },
    ]

    // when
    const summary = processIngress(items, budget)

    // then
    const dropped = summary.results.find((r) => r.id === "second")
    expect(dropped?.decision).toBe("drop")
    expect(dropped?.acceptedContent).toBe("")
  })
})
