/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { applyProviderConfig } from "./provider-config-handler"
import { createModelCacheState } from "../plugin-state"
import { clearVisionCapableModelsCache, readVisionCapableModelsCache } from "../shared/vision-capable-models-cache"

describe("applyProviderConfig", () => {
  test("clears stale model context limits when provider config changes", () => {
    // given
    const modelCacheState = createModelCacheState()
    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {
              "kimi-k2.5-free": {
                limit: { context: 262144 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    // when
    applyProviderConfig({
      config: {
        provider: {
          google: {
            models: {
              "gemini-2.5-pro": {
                limit: { context: 1048576 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    // then
    expect(Array.from(modelCacheState.modelContextLimitsCache.entries())).toEqual([
      ["google/gemini-2.5-pro", 1048576],
    ])
  })

  test("caches vision-capable models from modalities and capabilities", () => {
    // given
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    const config = {
      provider: {
        rundao: {
          models: {
            "public/qwen3.5-397b": {
              modalities: {
                input: ["text", "image"],
              },
            },
            "public/text-only": {
              modalities: {
                input: ["text"],
              },
            },
          },
        },
        google: {
          models: {
            "gemini-3-flash": {
              capabilities: {
                input: {
                  image: true,
                },
              },
            },
          },
        },
      },
    } satisfies Record<string, unknown>

    // when
    applyProviderConfig({ config, modelCacheState })

    // then
    expect(Array.from(visionCapableModelsCache.keys())).toEqual([
      "rundao/public/qwen3.5-397b",
      "google/gemini-3-flash",
    ])
    expect(readVisionCapableModelsCache()).toEqual([
      { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      { providerID: "google", modelID: "gemini-3-flash" },
    ])
  })

  test("clears stale vision-capable models when provider config changes", () => {
    // given
    const modelCacheState = createModelCacheState()
    const visionCapableModelsCache = modelCacheState.visionCapableModelsCache
    if (!visionCapableModelsCache) {
      throw new Error("visionCapableModelsCache should be initialized")
    }
    visionCapableModelsCache.set("stale/old-model", {
      providerID: "stale",
      modelID: "old-model",
    })

    // when
    applyProviderConfig({
      config: { provider: {} },
      modelCacheState,
    })

    // then
    expect(visionCapableModelsCache.size).toBe(0)
    expect(readVisionCapableModelsCache()).toEqual([])
  })
})

clearVisionCapableModelsCache()

describe("applyProviderConfig - Copilot explicit limit override", () => {
  test("explicit provider config limit overrides registry fallback for a Copilot model", () => {
    // given
    const modelCacheState = createModelCacheState()

    // when
    applyProviderConfig({
      config: {
        provider: {
          "github-copilot": {
            models: {
              "gpt-4o": {
                limit: { context: 128_000 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    // then
    expect(modelCacheState.modelContextLimitsCache.get("github-copilot/gpt-4o")).toBe(128_000)
  })

  test("clears stale Copilot model limits when provider config changes", () => {
    // given
    const modelCacheState = createModelCacheState()
    applyProviderConfig({
      config: {
        provider: {
          "github-copilot": {
            models: {
              "gpt-4o": { limit: { context: 128_000 } },
            },
          },
        },
      },
      modelCacheState,
    })

    // when
    applyProviderConfig({
      config: {
        provider: {
          "github-copilot": {
            models: {
              "claude-sonnet-4-5": { limit: { context: 200_000 } },
            },
          },
        },
      },
      modelCacheState,
    })

    // then
    expect(modelCacheState.modelContextLimitsCache.has("github-copilot/gpt-4o")).toBe(false)
    expect(modelCacheState.modelContextLimitsCache.get("github-copilot/claude-sonnet-4-5")).toBe(200_000)
  })
})
