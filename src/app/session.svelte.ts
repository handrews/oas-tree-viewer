// One-shot in-memory handoff for interactive uploads. Uploaded files can't be encoded in a
// bookmarkable URL (and we don't persist them), so the configure page resolves them up
// front and stashes the result here; the view page consumes it for a bare `/view`. A full
// page reload clears it — which is exactly why a reloaded upload view shows its empty state.

import type { Oad } from "../types";
import type { ResolvedRefs } from "../refs/types";

export interface SessionResult {
  oad: Oad;
  refs: ResolvedRefs;
}

export const session = $state<{ result: SessionResult | null }>({ result: null });
