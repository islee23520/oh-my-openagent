import type { Message, Part } from "@opencode-ai/sdk"
import { isRealUserMessage, isRealUserTextPart, log } from "../../shared"
import { createContextBudget } from "../../shared/context-budget"
import { resolveActualContextLimit } from "../../shared/context-limit-resolver"
import { getMainSessionID } from "../claude-code-session-state"
import type { ContextCollector } from "./collector"

interface OutputPart {
  type: string
  text?: string
  [key: string]: unknown
}

interface InjectionResult {
  injected: boolean
  contextLength: number
}

export function injectPendingContext(
  collector: ContextCollector,
  sessionID: string,
  parts: OutputPart[],
  model: { providerID?: string; modelID?: string } = {},
): InjectionResult {
  if (!collector.hasPending(sessionID)) {
    return { injected: false, contextLength: 0 }
  }

  const textPartIndex = parts.findIndex(isRealUserTextPart)
  if (textPartIndex === -1) {
    return { injected: false, contextLength: 0 }
  }

  const providerID = model.providerID ?? "unknown"
  const modelID = model.modelID ?? "unknown"
  const contextLimit = resolveActualContextLimit(providerID, modelID)
  const budget = createContextBudget({
    limits: { providerID, modelID, contextLimit },
  })
  const pending = collector.getBudgetedPending(sessionID, budget)
  collector.clear(sessionID)
  if (!pending.hasContent) {
    return { injected: false, contextLength: 0 }
  }

  const originalText = parts[textPartIndex].text ?? ""
  parts[textPartIndex].text = `${pending.merged}${formatBudgetNotice(pending.ingressResults)}\n\n---\n\n${originalText}`

  return {
    injected: true,
    contextLength: pending.merged.length,
  }
}

interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: OutputPart[]
}

export function createContextInjectorHook(collector: ContextCollector) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      const result = injectPendingContext(collector, input.sessionID, output.parts, input.model)
      if (result.injected) {
        log("[context-injector] Injected pending context via chat.message", {
          sessionID: input.sessionID,
          contextLength: result.contextLength,
        })
      }
    },
  }
}

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function getSessionIDFromMessageInfo(info: Message): string | undefined {
  return "sessionID" in info && typeof info.sessionID === "string" ? info.sessionID : undefined
}

function hasText(part: Part): boolean {
  return "text" in part && typeof part.text === "string" && part.text.length > 0
}

function resolveMessageModel(info: Message): { providerID: string; modelID: string } {
  const modelInfo = info as Message & {
    model?: { providerID?: string; modelID?: string }
    providerID?: string
    modelID?: string
  }
  return {
    providerID: modelInfo.model?.providerID ?? modelInfo.providerID ?? "unknown",
    modelID: modelInfo.model?.modelID ?? modelInfo.modelID ?? "unknown",
  }
}

function formatBudgetNotice(ingressResults: Array<{ decision: string }>): string {
  const truncated = ingressResults.filter((result) => result.decision === "truncate").length
  const dropped = ingressResults.filter((result) => result.decision === "drop").length
  if (truncated === 0 && dropped === 0) {
    return ""
  }

  return `\n\n[Context budget: ${truncated} item(s) truncated, ${dropped} item(s) dropped to fit provider context budget]`
}

export function createContextInjectorMessagesTransformHook(
  collector: ContextCollector
): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      log("[DEBUG] experimental.chat.messages.transform called", {
        messageCount: messages.length,
      })
      if (messages.length === 0) {
        return
      }

      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }

      if (lastUserMessageIndex === -1) {
        log("[DEBUG] No user message found in messages")
        return
      }

      const lastUserMessage = messages[lastUserMessageIndex]
      if (lastUserMessage === undefined) {
        return
      }
      if (!isRealUserMessage(lastUserMessage)) {
        log("[context-injector] Latest user message is synthetic/internal, skipping injection", {
          sessionID: getSessionIDFromMessageInfo(lastUserMessage.info) ?? getMainSessionID(),
        })
        return
      }
      const messageSessionID = getSessionIDFromMessageInfo(lastUserMessage.info)
      const sessionID = messageSessionID ?? getMainSessionID()
      log("[DEBUG] Extracted sessionID", {
        messageSessionID,
        mainSessionID: getMainSessionID(),
        sessionID,
        infoKeys: Object.keys(lastUserMessage.info),
      })
      if (!sessionID) {
        log("[DEBUG] sessionID is undefined (both message.info and mainSessionID are empty)")
        return
      }

      const hasPending = collector.hasPending(sessionID)
      log("[DEBUG] Checking hasPending", {
        sessionID,
        hasPending,
      })
      if (!hasPending) {
        return
      }

      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => isRealUserTextPart(p) && hasText(p)
      )

      if (textPartIndex === -1) {
        log("[context-injector] No text part found in last user message, skipping injection", {
          sessionID,
          partsCount: lastUserMessage.parts.length,
        })
        return
      }

      const model = resolveMessageModel(lastUserMessage.info)
      const contextLimit = resolveActualContextLimit(model.providerID, model.modelID)
      const budget = createContextBudget({
        limits: { ...model, contextLimit },
      })
      const pending = collector.getBudgetedPending(sessionID, budget)
      collector.clear(sessionID)
      if (!pending.hasContent) {
        return
      }

      const syntheticPart = {
        id: `synthetic_hook_${sessionID}`,
        messageID: lastUserMessage.info.id,
        sessionID: messageSessionID ?? "",
        type: "text" as const,
        text: `${pending.merged}${formatBudgetNotice(pending.ingressResults)}`,
        synthetic: true,
      }

      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart as Part)

      log("[context-injector] Inserted synthetic part with hook content", {
        sessionID,
        contentLength: pending.merged.length,
      })
    },
  }
}
