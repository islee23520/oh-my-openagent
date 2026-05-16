import { describe, expect, it } from "bun:test"
import { estimateContentSize, estimateTotalSize, CHARS_PER_TOKEN } from "./context-size-estimator"

describe("estimateContentSize", () => {
  it("returns zero tokens for empty string", () => {
    // given
    const input = { content: "" }

    // when
    const result = estimateContentSize(input)

    // then
    expect(result.chars).toBe(0)
    expect(result.tokens).toBe(0)
  })

  it("estimates tokens using 4 chars per token for plain text", () => {
    // given
    const content = "a".repeat(40)

    // when
    const result = estimateContentSize({ content, kind: "text" })

    // then
    expect(result.chars).toBe(40)
    expect(result.tokens).toBe(10)
  })

  it("produces higher token estimate for code kind due to denser tokenization", () => {
    // given
    const content = "x".repeat(40)

    // when
    const textResult = estimateContentSize({ content, kind: "text" })
    const codeResult = estimateContentSize({ content, kind: "code" })

    // then
    expect(codeResult.tokens).toBeGreaterThan(textResult.tokens)
  })

  it("produces higher token estimate for json kind", () => {
    // given
    const content = "x".repeat(40)

    // when
    const textResult = estimateContentSize({ content, kind: "text" })
    const jsonResult = estimateContentSize({ content, kind: "json" })

    // then
    expect(jsonResult.tokens).toBeGreaterThan(textResult.tokens)
  })

  it("defaults to text ratio when kind is omitted", () => {
    // given
    const content = "a".repeat(CHARS_PER_TOKEN * 5)

    // when
    const result = estimateContentSize({ content })

    // then
    expect(result.tokens).toBe(5)
  })

  it("rounds up fractional token counts", () => {
    // given
    const content = "a".repeat(5)

    // when
    const result = estimateContentSize({ content, kind: "text" })

    // then
    expect(result.tokens).toBe(2)
  })
})

describe("estimateTotalSize", () => {
  it("returns zero for empty input array", () => {
    // given / when
    const result = estimateTotalSize([])

    // then
    expect(result.chars).toBe(0)
    expect(result.tokens).toBe(0)
  })

  it("sums chars and tokens across multiple inputs", () => {
    // given
    const inputs = [
      { content: "a".repeat(8), kind: "text" as const },
      { content: "b".repeat(8), kind: "text" as const },
    ]

    // when
    const result = estimateTotalSize(inputs)

    // then
    expect(result.chars).toBe(16)
    expect(result.tokens).toBe(4)
  })

  it("handles mixed kinds correctly", () => {
    // given
    const inputs = [
      { content: "a".repeat(8), kind: "text" as const },
      { content: "b".repeat(8), kind: "code" as const },
    ]

    // when
    const result = estimateTotalSize(inputs)

    // then
    expect(result.chars).toBe(16)
    expect(result.tokens).toBeGreaterThan(4)
  })
})
