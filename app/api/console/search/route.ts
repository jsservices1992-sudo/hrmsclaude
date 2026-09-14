import { getSessionUser } from "@/lib/auth/session";
import { globalSearch } from "@/lib/search/global";

/**
 * Backs the console's command palette. A plain Route Handler rather than a
 * Server Action — the client fires this on every debounced keystroke and
 * needs to abort a stale request, which Server Actions (queued/sequential
 * per client) don't support.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ results: [] }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await globalSearch(user, q);
  return Response.json({ results });
}
