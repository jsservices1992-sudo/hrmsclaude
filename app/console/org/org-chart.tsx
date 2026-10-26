"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrgNode } from "@/lib/hris/org";
import { NodeEditButton, type PersonOption } from "./forms";

/**
 * The reporting tree drawn as an org chart: a card per person, lines
 * from each manager down to their team, and every team foldable. The
 * top two levels start open — enough to see the shape of the company
 * without a screen-wide row of everybody at once.
 */

const AVATAR = ["bg-indigo text-on-indigo", "bg-teal text-white", "bg-[#0EA5E9] text-white", "bg-[#F59E0B] text-white", "bg-rust text-white"];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function matches(node: OrgNode, q: string): boolean {
  if (!q) return false;
  return `${node.name} ${node.empCode} ${node.designation ?? ""} ${node.department ?? ""}`.toLowerCase().includes(q);
}

function subtreeMatches(node: OrgNode, q: string): boolean {
  return matches(node, q) || node.children.some((c) => subtreeMatches(c, q));
}

function collect(nodes: OrgNode[], pick: (n: OrgNode) => boolean, out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (pick(n)) out.add(n.id);
    collect(n.children, pick, out);
  }
  return out;
}

type Ctx = {
  open: Set<string>;
  toggle: (id: string) => void;
  q: string;
  today: string;
  canAct: boolean;
  departments: PersonOption[];
  people: PersonOption[];
};

function PersonCard({ node, ctx, colour }: { node: OrgNode; ctx: Ctx; colour: number }) {
  const leaving = node.status !== "active";
  const gone = node.status === "exited" || (node.lastWorkingDay !== null && node.lastWorkingDay <= ctx.today);
  const hit = matches(node, ctx.q);
  const isOpen = ctx.open.has(node.id);
  return (
    <div
      className={`group relative w-52 rounded-2xl border bg-surface p-3 text-left card-lift transition-base ${
        hit ? "border-indigo ring-4 ring-indigo-soft" : "border-line hover:border-indigo/40"
      } ${gone ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${AVATAR[colour % AVATAR.length]}`}>
          {initials(node.name)}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/console/employees/${node.id}`} className="block truncate text-sm font-semibold text-ink hover:text-indigo">
            {node.name}
          </Link>
          <p className="truncate text-xs text-ink-2" title={node.designation ?? undefined}>
            {node.designation ?? "No designation"}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {node.department && (
          <span className="max-w-full truncate rounded-full bg-indigo-soft px-2 py-0.5 text-[11px] font-semibold text-indigo">{node.department}</span>
        )}
        <span className="font-mono text-[11px] text-ink-3">{node.empCode}</span>
        {leaving && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gone ? "bg-rust-soft text-rust" : "bg-amber-soft text-amber"}`}>
            {gone ? "Left" : `Leaving ${node.lastWorkingDay ? node.lastWorkingDay.slice(8) + "/" + node.lastWorkingDay.slice(5, 7) : ""}`}
          </span>
        )}
      </div>
      {leaving && node.directCount > 0 && (
        <p className={`mt-2 text-[11px] font-semibold ${node.replacementName ? "text-teal" : "text-rust"}`}>
          {node.replacementName ? `Team goes to ${node.replacementName}` : "Team needs a manager"}
        </p>
      )}
      {ctx.canAct && (
        <div className="absolute right-2 top-2">
          <NodeEditButton
            name={node.name}
            empCode={node.empCode}
            employeeId={node.id}
            designation={node.designation}
            departmentId={node.departmentId}
            managerId={node.managerId}
            departments={ctx.departments}
            managers={ctx.people}
          />
        </div>
      )}
      {node.directCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            const card = e.currentTarget.parentElement;
            ctx.toggle(node.id);
            /* Opening a wide team pushes this card sideways; bring it back to the middle. */
            requestAnimationFrame(() => card?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }));
          }}
          aria-expanded={isOpen}
          className={`absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm transition-base ${
            isOpen ? "border-indigo bg-indigo text-on-indigo" : "border-line bg-surface text-ink-2 hover:border-indigo hover:text-indigo"
          }`}
        >
          {isOpen ? "−" : "+"} {node.directCount} report{node.directCount === 1 ? "" : "s"}
          {node.totalCount !== node.directCount ? ` · ${node.totalCount}` : ""}
        </button>
      )}
    </div>
  );
}

function Branch({ node, ctx, colour }: { node: OrgNode; ctx: Ctx; colour: number }) {
  const kids = ctx.q ? node.children.filter((c) => subtreeMatches(c, ctx.q)) : node.children;
  const open = ctx.open.has(node.id) && kids.length > 0;
  return (
    <li>
      <PersonCard node={node} ctx={ctx} colour={colour} />
      {open &&
        (kids.length > 2 && kids.every((c) => c.children.length === 0) ? (
          /* A team with no managers in it stacks in a column under its
             manager — one card wide, however many people are in it. */
          <ul>
            <li>
              <div className="relative flex flex-col items-center gap-3 before:absolute before:bottom-6 before:left-1/2 before:top-0 before:border-l-[1.5px] before:border-line">
                {kids.map((c, i) => (
                  <div key={c.id} className="relative">
                    <PersonCard node={c} ctx={ctx} colour={colour + i + 1} />
                  </div>
                ))}
              </div>
            </li>
          </ul>
        ) : (
          <ul>
            {kids.map((c, i) => (
              <Branch key={c.id} node={c} ctx={ctx} colour={colour + i + 1} />
            ))}
          </ul>
        ))}
    </li>
  );
}

export function OrgChart({
  roots,
  q,
  today,
  canAct,
  departments,
  people,
}: {
  roots: OrgNode[];
  q: string;
  today: string;
  canAct: boolean;
  departments: PersonOption[];
  people: PersonOption[];
}) {
  /* Someone with neither a manager nor a team is not part of any tree —
     a row of them across the top would push the real chart off screen. */
  const trees = roots.filter((r) => r.children.length > 0 || roots.length === 1);
  /* Leavers with no team are history, not a gap in the chart. */
  const loose = roots.filter(
    (r) => !trees.includes(r) && r.status !== "exited" && !(r.lastWorkingDay && r.lastWorkingDay <= today),
  );

  const managers = useMemo(() => collect(roots, (n) => n.children.length > 0), [roots]);
  const initial = useMemo(
    () => (q ? collect(roots, (n) => n.children.some((c) => subtreeMatches(c, q))) : collect(roots, (n) => n.depth < 1 && n.children.length > 0)),
    [roots, q],
  );
  const [open, setOpen] = useState<Set<string>>(initial);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ctx: Ctx = { open, toggle, q, today, canAct, departments, people };

  /* A chart wider than the screen opens on its middle, where the top of the company is. */
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);
  const shownLoose = q ? loose.filter((n) => matches(n, q)) : loose;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(new Set(managers))}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:border-indigo hover:text-indigo"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setOpen(new Set())}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:border-indigo hover:text-indigo"
        >
          Collapse all
        </button>
        <span className="text-xs text-ink-3">Click a card&rsquo;s report count to open or close that team.</span>
      </div>

      {trees.length > 0 && (
        <div ref={scroller} className="overflow-x-auto rounded-2xl border border-line bg-surface-2/50 px-4 pb-8 pt-6">
          <div className="org-tree mx-auto w-max">
            <ul>
              {trees.map((r, i) => (
                <Branch key={r.id} node={r} ctx={ctx} colour={i * 2} />
              ))}
            </ul>
          </div>
        </div>
      )}

      {shownLoose.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink">
            No manager set <span className="font-normal text-ink-3">· {shownLoose.length} — set who they report to with Edit</span>
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
            {shownLoose.map((n, i) => (
              <PersonCard key={n.id} node={n} ctx={ctx} colour={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
