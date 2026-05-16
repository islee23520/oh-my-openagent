import type { PluginInput } from "@opencode-ai/plugin";
import { promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { createContextBudget, processIngress } from "../../shared/context-budget";
import { resolveActualContextLimit } from "../../shared/context-limit-resolver";
import { findAgentsMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

type AgentsInjectionCandidate = {
  agentsPath: string;
  agentsDir: string;
  content: string;
  truncationNotice: string;
};

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  if (!sessionCaches.has(sessionID)) {
    sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
  }
  return sessionCaches.get(sessionID)!;
}

export async function processFilePathForAgentsInjection(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  // Guard: output.output may be non-string at runtime (e.g. MCP bridge format changes).
  // Consistent with the pattern used in tool-output-truncator and other hooks.
  if (typeof input.output.output !== "string") return;

  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const agentsPaths = await findAgentsMdUp({ startDir: dir, rootDir: input.ctx.directory });

  const candidates: AgentsInjectionCandidate[] = [];
  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsDir)) continue;

    try {
      const content = await fsPromises.readFile(agentsPath, "utf-8");
      cache.add(agentsDir);
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${agentsPath}]`
        : "";

      candidates.push({
        agentsPath,
        agentsDir,
        content: result,
        truncationNotice,
      });
    } catch {}
  }

  if (candidates.length === 0) return;

  const contextLimit = resolveActualContextLimit("unknown", "unknown");
  const budget = createContextBudget({
    limits: { providerID: "unknown", modelID: "unknown", contextLimit },
    safetyMarginTokens: 0,
  });
  const ingress = processIngress(
    candidates.map((candidate) => ({
      id: candidate.agentsPath,
      content: candidate.content,
      kind: "text" as const,
      priority: 1,
    })),
    budget,
  );
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.agentsPath, candidate]));

  for (const ingressResult of ingress.results) {
    const candidate = candidateByPath.get(ingressResult.id);
    if (!candidate) continue;
    cache.add(candidate.agentsDir);
    if (ingressResult.decision === "drop") {
      input.output.output += `\n\n[Directory Context: ${candidate.agentsPath}]\n[Budget gate: content skipped — ${ingressResult.reason}]`;
      continue;
    }
    const budgetNotice = ingressResult.decision === "truncate"
      ? `\n\n[Budget gate: content truncated — ${ingressResult.reason}]`
      : "";
    input.output.output += `\n\n[Directory Context: ${candidate.agentsPath}]\n${ingressResult.acceptedContent}${candidate.truncationNotice}${budgetNotice}`;
  }

  const dirty = ingress.results.length > 0;
  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
