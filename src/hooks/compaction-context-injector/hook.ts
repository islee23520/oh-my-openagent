import type { BackgroundManager } from "../../features/background-agent"
import {
  clearCompactionAgentConfigCheckpoint,
  type CompactionAgentConfigCheckpoint,
  setCompactionAgentConfigCheckpoint,
} from "../../shared/compaction-agent-config-checkpoint"
import { createContextBudget, processIngress } from "../../shared/context-budget"
import { resolveActualContextLimit } from "../../shared/context-limit-resolver"
import { resolveMessageEventSessionID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"
import { COMPACTION_CONTEXT_PROMPT } from "./compaction-context-prompt"
import { resolveSessionPromptConfig } from "./session-prompt-config-resolver"
import { finalizeTrackedAssistantMessage, shouldTreatAssistantPartAsOutput, trackAssistantOutput, type TailMonitorState } from "./tail-monitor"
import { resolveSessionID } from "./session-id"
import type { CompactionContextClient, CompactionContextInjector } from "./types"
import { createRecoveryLogic } from "./recovery"

const DELEGATED_HISTORY_MAX_TOKENS = 4_000

function createDelegatedHistoryBudget(model: CompactionAgentConfigCheckpoint["model"]) {
  const providerID = model?.providerID ?? "unknown"
  const modelID = model?.modelID ?? "unknown"
  const contextLimit = resolveActualContextLimit(providerID, modelID)
  const availableTokens = Math.min(contextLimit, DELEGATED_HISTORY_MAX_TOKENS)

  return {
    budget: createContextBudget({
      limits: { providerID, modelID, contextLimit },
      safetyMarginTokens: Math.max(0, contextLimit - availableTokens),
    }),
    providerID,
    modelID,
    contextLimit,
    availableTokens,
  }
}

export function createCompactionContextInjector(options?: {
  ctx?: CompactionContextClient
  backgroundManager?: BackgroundManager
}): CompactionContextInjector {
  const ctx = options?.ctx
  const backgroundManager = options?.backgroundManager
  const tailStates = new Map<string, TailMonitorState>()
  const promptConfigCheckpoints = new Map<string, CompactionAgentConfigCheckpoint>()

  const getTailState = (sessionID: string): TailMonitorState => {
    const existing = tailStates.get(sessionID)
    if (existing) {
      return existing
    }

    const created: TailMonitorState = {
      currentHasOutput: false,
      consecutiveNoTextMessages: 0,
    }
    tailStates.set(sessionID, created)
    return created
  }

  const { recoverCheckpointedAgentConfig, maybeWarnAboutNoTextTail } = createRecoveryLogic(ctx, getTailState)

  const restore = async (sessionID: string): Promise<boolean> => {
    return recoverCheckpointedAgentConfig(sessionID, "compaction.autocontinue")
  }

  const capture = async (sessionID: string): Promise<void> => {
    if (sessionID) {
      clearCompactionAgentConfigCheckpoint(sessionID)
      promptConfigCheckpoints.delete(sessionID)
    }

    if (!ctx || !sessionID) {
      return
    }

    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    if (!promptConfig.agent && !promptConfig.model && !promptConfig.tools) {
      return
    }

    promptConfigCheckpoints.set(sessionID, promptConfig)
    setCompactionAgentConfigCheckpoint(sessionID, promptConfig)
    log(`[compaction-context-injector] Captured agent checkpoint before compaction`, {
      sessionID,
      agent: promptConfig.agent,
      model: promptConfig.model,
      hasTools: !!promptConfig.tools,
    })
  }

  const inject = (sessionID?: string): string => {
    let prompt = COMPACTION_CONTEXT_PROMPT

    if (backgroundManager && sessionID) {
      const history = backgroundManager.taskHistory.formatForCompaction(sessionID)
      if (history) {
        const budgetContext = createDelegatedHistoryBudget(promptConfigCheckpoints.get(sessionID)?.model)
        const summary = processIngress(
          [{ id: "delegated-history", content: history, kind: "text", priority: 1 }],
          budgetContext.budget,
        )
        const result = summary.results[0]
        if (result && result.decision !== "drop") {
          const truncationNote =
            result.decision === "truncate"
              ? `\n> [history truncated: ${result.originalTokens} tokens → ${result.acceptedTokens} tokens to fit ${budgetContext.availableTokens}-token delegated-history budget (${budgetContext.providerID}/${budgetContext.modelID}, context limit ${budgetContext.contextLimit})]\n`
              : ""
          prompt += `\n### Active/Recent Delegated Sessions\n${result.acceptedContent}${truncationNote}\n`
        }
      }
    }

    return prompt
  }

  const event = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        clearCompactionAgentConfigCheckpoint(sessionID)
        promptConfigCheckpoints.delete(sessionID)
        tailStates.delete(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const noTextCount = finalizeTrackedAssistantMessage(getTailState(sessionID))
      if (noTextCount > 0) {
        await maybeWarnAboutNoTextTail(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const tailState = getTailState(sessionID)
      finalizeTrackedAssistantMessage(tailState)
      tailState.lastCompactedAt = Date.now()
      await maybeWarnAboutNoTextTail(sessionID)
      await recoverCheckpointedAgentConfig(sessionID, "session.compacted")
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        id?: string
        role?: string
        sessionID?: string
      } | undefined

      const sessionID = resolveMessageEventSessionID(props)
      if (!sessionID || info?.role !== "assistant" || !info.id) {
        return
      }

      const tailState = getTailState(sessionID)
      if (tailState.currentMessageID && tailState.currentMessageID !== info.id) {
        finalizeTrackedAssistantMessage(tailState)
        await maybeWarnAboutNoTextTail(sessionID)
      }

      if (tailState.currentMessageID !== info.id) {
        tailState.currentMessageID = info.id
        tailState.currentHasOutput = false
      }
      return
    }

    if (event.type === "message.part.delta") {
      const sessionID = resolveMessageEventSessionID(props)
      const messageID = props?.messageID as string | undefined
      const field = props?.field as string | undefined
      const delta = props?.delta as string | undefined

      if (!sessionID || field !== "text" || !delta?.trim()) {
        return
      }

      trackAssistantOutput(getTailState(sessionID), messageID)
      return
    }

    if (event.type === "message.part.updated") {
      const part = props?.part as {
        messageID?: string
        sessionID?: string
        type?: string
        text?: string
      } | undefined

      if (!part?.sessionID || !shouldTreatAssistantPartAsOutput(part)) {
        return
      }

      trackAssistantOutput(getTailState(part.sessionID), part.messageID)
    }
  }

  return { capture, restore, inject, event }
}
