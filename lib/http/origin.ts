import "server-only";
import { headers } from "next/headers";

/**
 * Where this deployment is reachable, for links that leave it.
 *
 * Read from the request rather than configured, because the same build
 * serves a preview URL and a production one, and a link in an email has
 * to point at the host the person was actually using. The forwarded
 * headers come from the platform's own proxy; behind an untrusted one
 * they would be attacker-controlled, so an explicit APP_ORIGIN wins
 * wherever it is set.
 */
export async function currentOrigin(): Promise<string> {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
