import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  createCopilotRecoveryHook,
  createRecoveryHook,
  executeCompactMock,
  getLastAssistantMock,
  getProviderFamilyMock,
  parseAnthropicTokenLimitErrorMock,
  setupDelayedTimeoutMocks,
} from "./recovery-hook.test-support"

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  beforeEach(() => {
    executeCompactMock.mockClear()
    getLastAssistantMock.mockClear()
    parseAnthropicTokenLimitErrorMock.mockClear()
    getProviderFamilyMock.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  test("cancels pending timer when session.idle handles compaction first", async () => {
    //#given
    const { restore, getClearTimeoutCalls, getScheduledTimeouts } = setupDelayedTimeoutMocks()
    let compactedSessionID: unknown
    executeCompactMock.mockImplementationOnce(async (...args: unknown[]) => {
      compactedSessionID = args[0]
    })
    const hook = createRecoveryHook()

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-race", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-race" },
        },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([getScheduledTimeouts()[0]])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(compactedSessionID).toBe("session-race")
    } finally {
      restore()
    }
  })

  test("does not treat empty summary assistant messages as successful compaction", async () => {
    //#given
    const { restore, getClearTimeoutCalls, getScheduledTimeouts } = setupDelayedTimeoutMocks()
    let compactedSessionID: unknown
    executeCompactMock.mockImplementationOnce(async (...args: unknown[]) => {
      compactedSessionID = args[0]
    })
    getLastAssistantMock.mockResolvedValueOnce({
      info: {
        summary: true,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
      },
      hasContent: false,
    })
    const hook = createRecoveryHook()

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-empty-summary", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-empty-summary" },
        },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([getScheduledTimeouts()[0]])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(compactedSessionID).toBe("session-empty-summary")
    } finally {
      restore()
    }
  })

  test("#given active pending and retry timers #when dispose is called #then it clears both timer maps", async () => {
    //#given
    const { createUntrackedTimeout, getClearTimeoutCalls, getScheduledTimeouts, restore, runScheduledTimeout } =
      setupDelayedTimeoutMocks()
    executeCompactMock.mockImplementationOnce(async (...args: Parameters<typeof executeCompactMock>) => {
      const sessionID = args[0]
      const autoCompactState = args[2]

      autoCompactState.retryTimerBySession.set(sessionID, createUntrackedTimeout())
    })
    const hook = createRecoveryHook()

    try {
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-retry", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-pending", error: "prompt is too long" },
        },
      })

      runScheduledTimeout(0)

      const [retryTimer, pendingTimer] = getScheduledTimeouts()

      //#when
      hook.dispose()

      //#then
      expect(getClearTimeoutCalls()).toEqual(expect.arrayContaining([retryTimer, pendingTimer]))
    } finally {
      restore()
    }
  })

  describe("provider family gating", () => {
    test("#given Anthropic provider error #when session.error fires #then executeCompact is scheduled", async () => {
      //#given
      const { restore } = setupDelayedTimeoutMocks()
      const hook = createRecoveryHook()

      try {
        //#when
        await hook.event({
          event: {
            type: "session.error",
            properties: { sessionID: "session-anthropic", error: "prompt is too long" },
          },
        })

        //#then
        expect(executeCompactMock).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })

    test("#given Anthropic provider error #when session.idle fires #then executeCompact is called", async () => {
      //#given
      const hook = createRecoveryHook()

      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-anthropic-idle", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-anthropic-idle" },
        },
      })

      //#then
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(executeCompactMock.mock.calls[0][0]).toBe("session-anthropic-idle")
    })

    test("#given github-copilot provider error #when session.error fires #then executeCompact is not scheduled", async () => {
      //#given
      const { restore } = setupDelayedTimeoutMocks()
      const { hook } = createCopilotRecoveryHook()

      try {
        //#when
        await hook.event({
          event: {
            type: "session.error",
            properties: { sessionID: "session-copilot", error: "prompt is too long" },
          },
        })

        //#then
        expect(executeCompactMock).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })

    test("#given github-copilot provider error #when session.idle fires #then executeCompact is not called", async () => {
      //#given
      const { hook } = createCopilotRecoveryHook()

      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-copilot-idle", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-copilot-idle" },
        },
      })

      //#then
      expect(executeCompactMock).not.toHaveBeenCalled()
    })

    test("#given github-copilot provider error #when session.error fires #then pending state is cleared to avoid retry loops", async () => {
      //#given
      const { restore } = setupDelayedTimeoutMocks()
      const { hook } = createCopilotRecoveryHook()

      try {
        //#when
        await hook.event({
          event: {
            type: "session.error",
            properties: { sessionID: "session-copilot-clear", error: "prompt is too long" },
          },
        })

        await hook.event({
          event: {
            type: "session.idle",
            properties: { sessionID: "session-copilot-clear" },
          },
        })

        //#then
        expect(executeCompactMock).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })
  })

})
