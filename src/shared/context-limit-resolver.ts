import process from "node:process"

import { getProviderCapability } from "./context-budget/provider-capability-registry"
import { log } from "./logger"

const DEFAULT_ANTHROPIC_ACTUAL_LIMIT = 200_000
export const UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK = 32_000
export type ContextLimitModelCacheState = {
  anthropicContext1MEnabled: boolean
  modelContextLimitsCache?: Map<string, number>
}

function getAnthropicActualLimit(modelCacheState?: ContextLimitModelCacheState): number {
  return (modelCacheState?.anthropicContext1MEnabled ?? false) ||
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : DEFAULT_ANTHROPIC_ACTUAL_LIMIT
}

function supportsCachedAnthropicLimit(modelID: string): boolean {
  return /^claude-(opus|sonnet)-4(?:-|\.)(?:6|7)(?:-high)?$/.test(modelID)
}

export function resolveActualContextLimit(
  providerID: string,
  modelID: string,
  modelCacheState?: ContextLimitModelCacheState,
): number {
  const capability = getProviderCapability(providerID)

  if (capability.family === "anthropic") {
    const explicit1M = getAnthropicActualLimit(modelCacheState)
    if (explicit1M === 1_000_000) return explicit1M

    const cachedLimit = modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`)
    if (cachedLimit && supportsCachedAnthropicLimit(modelID)) return cachedLimit

    return DEFAULT_ANTHROPIC_ACTUAL_LIMIT
  }

  const cachedLimit = modelCacheState?.modelContextLimitsCache?.get(`${providerID}/${modelID}`)
  if (cachedLimit !== undefined) return cachedLimit

  if (capability.family === "unknown") {
    log(`[context-limit-resolver] unknown provider "${providerID}" with no cached limit; using conservative fallback`, { providerID, modelID, fallback: UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK })
    return UNKNOWN_PROVIDER_CONTEXT_LIMIT_FALLBACK
  }

  log(`[context-limit-resolver] known provider "${providerID}" (family: ${capability.family}) with no cached limit; using registry fallback`, { providerID, modelID, fallback: capability.contextLimitFallback })
  return capability.contextLimitFallback
}
