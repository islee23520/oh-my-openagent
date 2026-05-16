import type { PluginInput } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { createContextBudget, processIngress } from "../../shared/context-budget";
import { resolveActualContextLimit } from "../../shared/context-limit-resolver";
import { findReadmeMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

type ReadmeInjectionCandidate = {
  readmePath: string;
  readmeDir: string;
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

export async function processFilePathForReadmeInjection(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
   const readmePaths = await findReadmeMdUp({ startDir: dir, rootDir: input.ctx.directory });

  const candidates: ReadmeInjectionCandidate[] = [];
  for (const readmePath of readmePaths) {
    const readmeDir = dirname(readmePath);
    if (cache.has(readmeDir)) continue;

    try {
      const content = await readFile(readmePath, "utf-8");
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${readmePath}]`
        : "";

      candidates.push({
        readmePath,
        readmeDir,
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
      id: candidate.readmePath,
      content: candidate.content,
      kind: "text" as const,
      priority: 1,
    })),
    budget,
  );
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.readmePath, candidate]));

  for (const ingressResult of ingress.results) {
    const candidate = candidateByPath.get(ingressResult.id);
    if (!candidate) continue;
    cache.add(candidate.readmeDir);
    if (ingressResult.decision === "drop") {
      input.output.output += `\n\n[Project README: ${candidate.readmePath}]\n[Budget gate: content skipped — ${ingressResult.reason}]`;
      continue;
    }
    const budgetNotice = ingressResult.decision === "truncate"
      ? `\n\n[Budget gate: content truncated — ${ingressResult.reason}]`
      : "";
    input.output.output += `\n\n[Project README: ${candidate.readmePath}]\n${ingressResult.acceptedContent}${candidate.truncationNotice}${budgetNotice}`;
  }

  const dirty = ingress.results.length > 0;
  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
