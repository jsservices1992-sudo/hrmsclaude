import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, scopeCompanies } from "@/lib/auth/session";
import {
  CreateApiKeyForm,
  RevokeApiKeyForm,
  CreateWebhookForm,
  ToggleWebhookForm,
} from "./forms";
import { PageHeader, Card, Badge, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDateTime } from "@/lib/format/date";

export const metadata = { title: "API & webhooks" };

function fmt(iso: string | null) {
  if (!iso) return "—";
  return formatDateTime(iso);
}

export default async function ApiAdminPage() {
  const user = (await getSessionUser())!;
  const all = await db.select().from(s.companies).orderBy(asc(s.companies.name));
  const companies = scopeCompanies(user, all);
  const isAdmin = user.role === "admin";

  const companyIds = companies.map((c) => c.id);
  const keys = companyIds.length
    ? await db
        .select()
        .from(s.apiKeys)
        .where(inArray(s.apiKeys.companyId, companyIds))
        .orderBy(desc(s.apiKeys.createdAt))
    : [];
  const subs = companyIds.length
    ? await db
        .select()
        .from(s.webhookSubscriptions)
        .where(inArray(s.webhookSubscriptions.companyId, companyIds))
        .orderBy(desc(s.webhookSubscriptions.createdAt))
    : [];
  const subIds = subs.map((sub) => sub.id);
  const deliveries = subIds.length
    ? await db
        .select()
        .from(s.webhookDeliveries)
        .where(inArray(s.webhookDeliveries.subscriptionId, subIds))
        .orderBy(desc(s.webhookDeliveries.attemptedAt))
        .limit(30)
    : [];

  return (
    <div className="flex flex-col gap-8 max-w-5xl">
      <PageHeader
        eyebrow="Administration"
        title="API & webhooks"
        description={
          <>
            Read-only API keys and outbound webhook subscriptions, scoped to one
            company each — the same isolation the console itself enforces
            between legal entities. REST endpoints live under{" "}
            <code className="text-xs">/api/v1</code>, authorised with{" "}
            <code className="text-xs">Authorization: Bearer &lt;key&gt;</code>.
            {!isAdmin && (
              <span className="block text-xs text-rust mt-2">
                Only an administrator can create or revoke keys and subscriptions.
                You can see what exists, not change it.
              </span>
            )}
          </>
        }
      />

      {companies.map((company) => (
        <Card key={company.id} padded={false}>
          <div className="px-4 py-3 border-b border-line-2">
            <h2 className="font-medium">{company.name}</h2>
          </div>

          <div className="p-4 flex flex-col gap-6">
            {/* -------- API keys -------- */}
            <div className="flex flex-col gap-3">
              <p className="label text-ink-3">API keys</p>
              {keys.filter((k) => k.companyId === company.id).length === 0 ? (
                <p className="text-sm text-ink-3">No keys yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TH>Label</TH>
                    <TH>Prefix</TH>
                    <TH>Pay data</TH>
                    <TH>Created</TH>
                    <TH>Last used</TH>
                    <TH>Status</TH>
                    <TH>{""}</TH>
                  </THead>
                  <TBody>
                    {keys
                      .filter((k) => k.companyId === company.id)
                      .map((k) => (
                        <TR key={k.id}>
                          <TD>{k.label}</TD>
                          <TD>
                            <code className="text-xs">{k.displayPrefix}…</code>
                          </TD>
                          <TD>{k.compensationScope === "company" ? "Yes" : "No"}</TD>
                          <TD className="font-mono text-xs">{fmt(k.createdAt)}</TD>
                          <TD className="font-mono text-xs">{fmt(k.lastUsedAt)}</TD>
                          <TD>
                            <Badge tone={k.active ? "teal" : "neutral"}>
                              {k.active ? "Active" : "Revoked"}
                            </Badge>
                          </TD>
                          <TD>{isAdmin && k.active && <RevokeApiKeyForm id={k.id} />}</TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              )}
              {isAdmin && <CreateApiKeyForm companyId={company.id} />}
            </div>

            {/* -------- webhook subscriptions -------- */}
            <div className="flex flex-col gap-3 pt-2 border-t border-line-2">
              <p className="label text-ink-3">Webhook subscriptions</p>
              {subs.filter((sub) => sub.companyId === company.id).length === 0 ? (
                <p className="text-sm text-ink-3">No subscriptions yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {subs
                    .filter((sub) => sub.companyId === company.id)
                    .map((sub) => (
                      <div
                        key={sub.id}
                        className="border border-line-2 px-3 py-2 flex flex-col gap-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <code className="text-xs break-all">{sub.url}</code>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone={sub.active ? "teal" : "neutral"}>
                              {sub.active ? "Active" : "Paused"}
                            </Badge>
                            {isAdmin && <ToggleWebhookForm id={sub.id} active={sub.active} />}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {sub.events.split(",").map((e) => (
                            <code
                              key={e}
                              className="text-[11px] px-1.5 py-0.5 bg-canvas border border-line-2"
                            >
                              {e}
                            </code>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {isAdmin && <CreateWebhookForm companyId={company.id} />}
            </div>
          </div>
        </Card>
      ))}

      {/* -------- delivery log -------- */}
      <Card padded={false}>
        <div className="px-4 py-3 border-b border-line-2">
          <h2 className="font-medium">Recent deliveries</h2>
          <p className="text-xs text-ink-3 mt-1">
            Every attempt is logged whether it succeeded or not — nothing is
            silently dropped, so a subscriber that has been unreachable shows
            up here rather than only in a support ticket.
          </p>
        </div>
        {deliveries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No deliveries yet.</p>
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Event</TH>
              <TH>Endpoint</TH>
              <TH>Result</TH>
              <TH>Response</TH>
            </THead>
            <TBody>
              {deliveries.map((d) => {
                const sub = subs.find((sub) => sub.id === d.subscriptionId);
                return (
                  <TR key={d.id}>
                    <TD className="font-mono text-xs">{fmt(d.attemptedAt)}</TD>
                    <TD>
                      <code className="text-xs">{d.event}</code>
                    </TD>
                    <TD>
                      <code className="text-xs break-all whitespace-normal">{sub?.url ?? "(removed)"}</code>
                    </TD>
                    <TD>
                      <Badge tone={d.status === "delivered" ? "teal" : "rust"}>
                        {d.status === "delivered" ? "Delivered" : "Failed"}
                        {d.responseStatus ? ` · ${d.responseStatus}` : ""}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-ink-3 max-w-xs truncate">
                      {d.responseSnippet ?? "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
