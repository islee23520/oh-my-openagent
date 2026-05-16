import { mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { createAnthropicContextWindowLimitRecoveryHook } from "./recovery-hook"
import type { getProviderFamily } from "../../shared/context-budget/provider-capability-registry"

type ExecuteCompactFn = typeof import("./executor").executeCompact
type GetLastAssistantFn = typeof import("./executor").getLastAssistant
type ParseAnthropicTokenLimitErrorFn = typeof import("./parser").parseAnthropicTokenLimitError
type GetProviderFamilyFn = typeof getProviderFamily

export type MockLastAssistant = {
  info: {
    summary?: boolean
    providerID: string
    modelID: string
  }
  hasContent: boolean
}

export const executeCompactMock = mock<ExecuteCompactFn>(async () => {})
export const getLastAssistantMock = mock<GetLastAssistantFn>(async (): Promise<MockLastAssistant> => ({
  info: {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
  },
  hasContent: true,
}))
export const parseAnthropicTokenLimitErrorMock = mock<ParseAnthropicTokenLimitErrorFn>(() => ({
  currentTokens: 250000,
  maxTokens: 200000,
  errorType: "token_limit_exceeded",
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
}))
export const getProviderFamilyMock = mock<GetProviderFamilyFn>((providerID: string) => {
  if (providerID === "github-copilot" || providerID === "copilot") return "github-copilot"
  if (providerID === "anthropic") return "anthropic"
  return "unknown"
})

const pluginConfig = {
  git_master: {
    commit_footer: false,
    include_co_authored_by: false,
    git_env_prefix: "",
  },
} satisfies OhMyOpenCodeConfig

export function createRecoveryHook() {
  return createAnthropicContextWindowLimitRecoveryHook(
    createMockContext(),
    {
      pluginConfig,
      dependencies: {
        executeCompact: executeCompactMock,
        getLastAssistant: getLastAssistantMock,
        log: () => {},
        parseAnthropicTokenLimitError: parseAnthropicTokenLimitErrorMock,
        getProviderFamily: getProviderFamilyMock,
      },
    } as never,
  )
}

export function createCopilotRecoveryHook() {
  const copilotParseErrorMock = mock<ParseAnthropicTokenLimitErrorFn>(() => ({
    currentTokens: 60000,
    maxTokens: 64000,
    errorType: "token_limit_exceeded",
    providerID: "github-copilot",
    modelID: "gpt-4o",
  }))
  const copilotLastAssistantMock = mock<GetLastAssistantFn>(async (): Promise<MockLastAssistant> => ({
    info: {
      providerID: "github-copilot",
      modelID: "gpt-4o",
    },
    hasContent: true,
  }))
  return {
    hook: createAnthropicContextWindowLimitRecoveryHook(
      createMockContext(),
      {
        pluginConfig,
        dependencies: {
          executeCompact: executeCompactMock,
          getLastAssistant: copilotLastAssistantMock,
          log: () => {},
          parseAnthropicTokenLimitError: copilotParseErrorMock,
          getProviderFamily: getProviderFamilyMock,
        },
      } as never,
    ),
    copilotParseErrorMock,
    copilotLastAssistantMock,
  }
}

export function createMockContext(): PluginInput {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    project: {} as never,
    directory: "/tmp",
    worktree: "/tmp",
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  } as never
}

export function setupDelayedTimeoutMocks(): {
  createUntrackedTimeout: () => ReturnType<typeof setTimeout>
  runScheduledTimeout: (index: number) => void
  restore: () => void
  getClearTimeoutCalls: () => Array<ReturnType<typeof setTimeout>>
  getScheduledTimeouts: () => Array<ReturnType<typeof setTimeout>>
} {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const clearTimeoutCalls: Array<ReturnType<typeof setTimeout>> = []
  const scheduledTimeouts: Array<ReturnType<typeof setTimeout>> = []
  const scheduledCallbacks: Array<() => void> = []

  function createTimeoutHandle(): ReturnType<typeof setTimeout> {
    const timeoutID = originalSetTimeout(() => {}, 60_000)
    originalClearTimeout(timeoutID)
    return timeoutID
  }

  globalThis.setTimeout = ((callback: () => void, _delay?: number) => {
    const timeoutID = createTimeoutHandle()
    scheduledTimeouts.push(timeoutID)
    scheduledCallbacks.push(callback)
    return timeoutID
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timeoutID: ReturnType<typeof setTimeout>) => {
    clearTimeoutCalls.push(timeoutID)
    originalClearTimeout(timeoutID)
  }) as typeof clearTimeout

  return {
    createUntrackedTimeout: createTimeoutHandle,
    runScheduledTimeout: (index: number) => {
      scheduledCallbacks[index]?.()
    },
    restore: () => {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
    getClearTimeoutCalls: () => clearTimeoutCalls,
    getScheduledTimeouts: () => scheduledTimeouts,
  }
}
