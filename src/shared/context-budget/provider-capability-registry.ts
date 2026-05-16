export type ProviderFamily = "anthropic" | "github-copilot" | "unknown"

export type ProviderCapability = {
  family: ProviderFamily
  contextLimitFallback: number
  supportsExplicitContextConfig: boolean
}

const ANTHROPIC_CONTEXT_LIMIT_FALLBACK = 200_000
const GITHUB_COPILOT_CONTEXT_LIMIT_FALLBACK = 64_000

const REGISTRY: Record<string, ProviderCapability> = {
  anthropic: {
    family: "anthropic",
    contextLimitFallback: ANTHROPIC_CONTEXT_LIMIT_FALLBACK,
    supportsExplicitContextConfig: true,
  },
  "google-vertex-anthropic": {
    family: "anthropic",
    contextLimitFallback: ANTHROPIC_CONTEXT_LIMIT_FALLBACK,
    supportsExplicitContextConfig: true,
  },
  "aws-bedrock-anthropic": {
    family: "anthropic",
    contextLimitFallback: ANTHROPIC_CONTEXT_LIMIT_FALLBACK,
    supportsExplicitContextConfig: true,
  },
  "github-copilot": {
    family: "github-copilot",
    contextLimitFallback: GITHUB_COPILOT_CONTEXT_LIMIT_FALLBACK,
    supportsExplicitContextConfig: true,
  },
  copilot: {
    family: "github-copilot",
    contextLimitFallback: GITHUB_COPILOT_CONTEXT_LIMIT_FALLBACK,
    supportsExplicitContextConfig: true,
  },
}

const UNKNOWN_CAPABILITY: ProviderCapability = {
  family: "unknown",
  contextLimitFallback: 32_000,
  supportsExplicitContextConfig: false,
}

export function getProviderCapability(providerID: string): ProviderCapability {
  const normalized = providerID.toLowerCase()
  return REGISTRY[normalized] ?? UNKNOWN_CAPABILITY
}

export function getProviderFamily(providerID: string): ProviderFamily {
  return getProviderCapability(providerID).family
}

export function isKnownProvider(providerID: string): boolean {
  return getProviderFamily(providerID) !== "unknown"
}
