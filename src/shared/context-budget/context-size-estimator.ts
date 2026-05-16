/**
 * Deterministic context size estimator.
 *
 * Uses a char-to-token approximation (4 chars ≈ 1 token) which is accurate
 * enough for budget gating without requiring a tokenizer dependency.
 * The ratio is conservative: real tokenizers often produce fewer tokens for
 * English prose, so this errs on the side of over-counting.
 */

export const CHARS_PER_TOKEN = 4

export type ContentKind = "text" | "code" | "json" | "binary"

export type EstimateInput = {
  content: string
  kind?: ContentKind
}

export type SizeEstimate = {
  chars: number
  tokens: number
}

/**
 * Estimate the token count for a single content string.
 *
 * Code and JSON tend to tokenize more densely (more tokens per char) than
 * prose, so we apply a 0.8x multiplier to the char-per-token ratio for those
 * kinds, yielding a slightly higher token estimate.
 */
export function estimateContentSize(input: EstimateInput): SizeEstimate {
  const chars = input.content.length
  const ratio = input.kind === "code" || input.kind === "json" ? CHARS_PER_TOKEN * 0.8 : CHARS_PER_TOKEN
  const tokens = Math.ceil(chars / ratio)
  return { chars, tokens }
}

/**
 * Estimate the combined token count for multiple content pieces.
 */
export function estimateTotalSize(inputs: EstimateInput[]): SizeEstimate {
  let totalChars = 0
  let totalTokens = 0
  for (const input of inputs) {
    const estimate = estimateContentSize(input)
    totalChars += estimate.chars
    totalTokens += estimate.tokens
  }
  return { chars: totalChars, tokens: totalTokens }
}
