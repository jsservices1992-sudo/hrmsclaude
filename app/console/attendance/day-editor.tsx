"use client";

import { useActionState, useId, useState } from "react";
import { markAttendanceDay, type AttendanceState } from "./actions";
import { Dialog, Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export type DayCell = { date: string; status: string; basis: string };

const MARK: Record<string, { ch: string; cls: string; title: string }> = {
  present: { ch: "P", cls: "text-teal", title: "Present" },
  half_day: { ch: "½", cls: "text-brass", title: "Half day" },
  absent: { ch: "A", cls: "text-rust font-semibold", title: "Absent" },
  weekly_off: { ch: "·", cls: "text-ink-3", title: "Weekly off" },
  holiday: { ch: "H", cls: "text-indigo", title: "Holiday" },
  on_leave: { ch: "L", cls: "text-indigo", title: "On leave" },
  on_duty: { ch: "D", cls: "text-teal", title: "On duty" },
};

/**
 * One employee's row of the month grid, with every day clickable.
 *
 * Mounted per employee rather than per cell — thirty-odd rows of client
 * components instead of a thousand — so one dialog serves the whole row
 * and opens on whichever day was clicked. That gives both ways in at
 * once: click the day you can see is wrong, or open any row and pick the
 * date from the dialog.
 */
export function AttendanceDayRow({
  companyId,
  employeeId,
  name,
  days,
  canEdit,
}: {
  companyId: string;
  employeeId: string;
  name: string;
  days: DayCell[];
  canEdit: boolean;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [state, action] = useActionState<AttendanceState, FormData>(markAttendanceDay, {});
  const headingId = useId();

  const current = days.find((d) => d.date === openDate);

  return (
    <>
      {days.map((d) => {
        const mark = MARK[d.status] ?? MARK.present;
        const cell = <span className={`font-mono text-xs ${mark.cls}`}>{mark.ch}</span>;
        return (
          <td key={d.date} className="px-0.5 py-1 text-center" title={`${formatDate(d.date)} — ${d.basis}`}>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setOpenDate(d.date)}
                aria-label={`Edit ${name} on ${formatDate(d.date)} — currently ${mark.title}`}
                className="w-5 h-5 rounded hover:bg-indigo-soft hover:ring-1 hover:ring-indigo/40 transition-base"
              >
                {cell}
              </button>
            ) : (
              cell
            )}
          </td>
        );
      })}

      {canEdit && (
        <Dialog open={openDate !== null} onClose={() => setOpenDate(null)} size="sm" labelledBy={headingId}>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h2 id={headingId} className="label text-ink-2">{name}</h2>
              <p className="font-mono text-xs text-ink-3 mt-0.5">
                {formatDate(openDate)} · currently {MARK[current?.status ?? "present"]?.title.toLowerCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenDate(null)}
              className="label text-ink-3 hover:text-rust"
            >
              Close
            </button>
          </div>

          <form action={action} className="flex flex-col gap-2.5">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="employeeId" value={employeeId} />
            {/* Editable, so a row opened on one day can be pointed at another. */}
            <label className="flex flex-col gap-1">
              <span className="label text-ink-3">Date</span>
              <Select name="date" defaultValue={openDate ?? ""} key={openDate ?? "none"}>
                {days.map((d) => (
                  <option key={d.date} value={d.date}>
                    {formatDate(d.date)} — {MARK[d.status]?.title ?? d.status}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label text-ink-3">Mark as</span>
              <Select name="status" defaultValue="present">
                <option value="present">Present</option>
                <option value="half_day">Half day</option>
                <option value="absent">Absent</option>
                <option value="on_duty">On duty</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label text-ink-3">Reason</span>
              <Input name="reason" required placeholder="Required — overrides the punches" />
            </label>
            <SubmitButton variant="primary" pendingText="Saving…">Save day</SubmitButton>
            <FormFeedback state={state} />
          </form>
        </Dialog>
      )}
    </>
  );
}
