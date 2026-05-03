import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import {
  extractTranscriptIdentityFromSessionsMemoryHit,
  loadCombinedSessionStoreForGateway,
  resolveTranscriptStemToSessionKeys,
} from "openclaw/plugin-sdk/session-transcript-hit";
import {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveEffectiveSessionToolsVisibility,
} from "openclaw/plugin-sdk/session-visibility";

export async function filterMemorySearchHitsBySessionVisibility(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string | undefined;
  sandboxed: boolean;
  hits: MemorySearchResult[];
}): Promise<MemorySearchResult[]> {
  const visibility = resolveEffectiveSessionToolsVisibility({
    cfg: params.cfg,
    sandboxed: params.sandboxed,
  });
  const a2aPolicy = createAgentToAgentPolicy(params.cfg);
  const guard = params.requesterSessionKey
    ? await createSessionVisibilityGuard({
        action: "history",
        requesterSessionKey: params.requesterSessionKey,
        visibility,
        a2aPolicy,
      })
    : null;

  const { store: combinedSessionStore } = loadCombinedSessionStoreForGateway(params.cfg);

  const next: MemorySearchResult[] = [];
  for (const hit of params.hits) {
    if (hit.source !== "sessions") {
      next.push(hit);
      continue;
    }
    if (!params.requesterSessionKey || !guard) {
      continue;
    }
    const identity = extractTranscriptIdentityFromSessionsMemoryHit(hit.path);
    if (!identity) {
      continue;
    }
    const keys = resolveTranscriptStemToSessionKeys({
      store: combinedSessionStore,
      stem: identity.stem,
      ...(identity.archived && identity.ownerAgentId
        ? { archivedOwnerAgentId: identity.ownerAgentId }
        : {}),
    });
    if (keys.length === 0) {
      // External transcripts (e.g. Claude Code's ~/.claude/projects/*.jsonl)
      // are indexed by memory-core but never registered in OpenClaw's session
      // store, so resolveTranscriptStemToSessionKeys returns []. Treat
      // unresolvable hits as best-effort visible to match the CLI memory
      // search path, which bypasses this filter entirely.
      next.push(hit);
      continue;
    }
    const allowed = keys.some((key) => guard.check(key).allowed);
    if (!allowed) {
      continue;
    }
    next.push(hit);
  }
  return next;
}
