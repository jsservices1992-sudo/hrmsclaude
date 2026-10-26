import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { canManageSharedStatutory } from "@/lib/auth/permissions";
import { PageHeader, MetricStrip, Table, THead, TH, TBody, TR, TD, Badge, EmptyState } from "@/components/console/ui";
import { formatDateTime } from "@/lib/format/date";
import { setDemoStatus } from "./actions";

export const metadata = { title: "Demo requests" };

const TONE = { new: "indigo", contacted: "brass", closed: "neutral" } as const;

/**
 * Requests from the public site's "Book a demo" and "Talk to us". They
 * belong to nobody's company, so only the instance operator sees them.
 */
export default async function DemoRequestsPage() {
  const user = (await getSessionUser())!;
  if (!canManageSharedStatutory(user)) redirect("/console?denied=demo-requests");

  const rows = await db.select().from(s.demoRequests).orderBy(desc(s.demoRequests.createdAt)).limit(500);
  const count = (st: string) => rows.filter((r) => r.status === st).length;

  return (
    <div className="flex max-w-[84rem] flex-col gap-5">
      <PageHeader
        title="Demo requests"
        description="From Book a demo and Talk to us on the public site. Set SALES_EMAIL to also get each one by email."
      />
      <MetricStrip
        items={[
          { label: "New", value: count("new"), tone: count("new") ? "warning" : "default" },
          { label: "Contacted", value: count("contacted") },
          { label: "Closed", value: count("closed") },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No requests yet" description="When someone books a demo on the website, it appears here." />
      ) : (
        <Table>
          <THead>
            <TH>Received</TH>
            <TH>Person</TH>
            <TH>Company</TH>
            <TH>Plan</TH>
            <TH>Message</TH>
            <TH>Status</TH>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="text-xs text-ink-2 tnum">{formatDateTime(r.createdAt)}</TD>
                <TD>
                  <span className="block font-semibold text-ink">{r.name}</span>
                  <a href={`mailto:${r.email}`} className="block text-xs text-indigo hover:underline">
                    {r.email}
                  </a>
                  {r.phone && <span className="block text-xs text-ink-3">{r.phone}</span>}
                </TD>
                <TD>
                  <span className="block text-ink">{r.company}</span>
                  {r.employees && <span className="block text-xs text-ink-3">{r.employees} employees</span>}
                </TD>
                <TD className="capitalize text-ink-2">{r.plan ?? "—"}</TD>
                <TD className="max-w-[22rem] whitespace-normal text-xs text-ink-2">{r.message ?? "—"}</TD>
                <TD>
                  <form action={setDemoStatus} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    {r.status !== "contacted" && (
                      <button name="status" value="contacted" className="text-xs font-semibold text-indigo hover:underline">
                        Contacted
                      </button>
                    )}
                    {r.status !== "closed" && (
                      <button name="status" value="closed" className="text-xs font-semibold text-ink-3 hover:underline">
                        Close
                      </button>
                    )}
                  </form>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
