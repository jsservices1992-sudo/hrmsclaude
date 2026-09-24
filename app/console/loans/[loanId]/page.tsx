import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadLoan } from "@/lib/loans/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  canMutate,
} from "@/lib/auth/session";
import {
  HoldForm,
  ResumeForm,
  PrepaymentForm,
  WriteOffForm,
} from "../forms";
import { Card, Badge, type BadgeTone, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Loan" };

const LOAN_STATUS_TONE: Record<string, BadgeTone> = {
  on_hold: "brass",
  closed: "teal",
};

const SCHEDULE_STATUS_TONE: Record<string, BadgeTone> = {
  recovered: "teal",
  partial: "brass",
  skipped: "rust",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TXN_LABEL: Record<string, string> = {
  disbursement: "Disbursed",
  recovery: "Recovered",
  prepayment: "Repaid early",
  interest_accrual: "Interest accrued",
  hold: "Held",
  resume: "Resumed",
  waiver: "Waived",
  exit_recovery: "Recovered at exit",
  write_off: "Written off",
};

export default async function LoanDetailPage(
  props: PageProps<"/console/loans/[loanId]">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=loans");

  const { loanId } = await props.params;
  const detail = await loadLoan(loanId);
  if (!detail) notFound();
  if (!canAccessCompany(user, detail.employee.companyId)) {
    redirect("/console?denied=loans");
  }

  const { loan, employee, scheme, schedule, transactions } = detail;
  const canAct = canMutate(user);
  const nextDue = schedule.find((r) => r.status === "due");
  const totalInterest = schedule.reduce((a, r) => a + r.interestPaise, 0);

  return (
    <div className="flex flex-col gap-6 max-w-[76rem]">
      <div>
        <Link href="/console/loans" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Loans
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
          <div>
            <p className="text-xs font-medium text-ink-2">{loan.scheme}</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink mt-1">
              {employee.firstName} {employee.lastName}
            </h1>
            <p className="text-sm text-ink-2 mt-1">
              <span className="font-mono">{employee.empCode}</span> ·{" "}
              {formatINR(loan.principalPaise)} over {loan.tenureMonths} months ·
              started {loan.startedOn}
              {loan.purpose && ` · ${loan.purpose}`}
            </p>
          </div>
          <Badge tone={LOAN_STATUS_TONE[loan.status] ?? "neutral"}>
            {loan.status.replace(/_/g, " ")}
          </Badge>
        </div>
      </div>

      {detail.warnings.length > 0 && (
        <div
          className={`border-2 px-5 py-4 ${
            detail.reconciles
              ? "border-amber bg-amber-soft"
              : "border-rust bg-rust-soft"
          }`}
        >
          <p
            className={`label mb-1.5 ${detail.reconciles ? "text-amber" : "text-rust"}`}
          >
            {detail.reconciles ? "Note" : "The ledger does not reconcile"}
          </p>
          <ul className="text-sm text-ink-2 max-w-[74ch] flex flex-col gap-1">
            {detail.warnings.map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Outstanding", v: formatINR(loan.outstandingPaise) },
          { l: "Instalment", v: formatINR(loan.instalmentPaise) },
          {
            l: "Instalments left",
            v: String(detail.remainingMonths),
          },
          {
            l: "Interest over the loan",
            v: formatINR(totalInterest),
          },
        ].map((x) => (
          <StatCard key={x.l} label={x.l} value={x.v} />
        ))}
      </div>

      {loan.status === "on_hold" && (
        <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-amber mb-1">Recovery paused</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {loan.holdReason ?? "No reason recorded."}
            {loan.holdUntil && ` Held until ${loan.holdUntil}.`} Nothing will be
            deducted in the next run.
          </p>
        </div>
      )}

      {/* actions */}
      {canAct && loan.status !== "closed" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Act on this loan</span>
          </div>
          <div className="flex flex-col divide-y divide-line-2">
            <div className="px-4 py-3">
              <p className="text-xs font-medium text-ink-2 mb-2">Early repayment</p>
              <PrepaymentForm
                loanId={loan.id}
                outstandingPaise={loan.outstandingPaise}
              />
            </div>
            <div className="px-4 py-3">
              <p className="text-xs font-medium text-ink-2 mb-2">
                {loan.status === "on_hold" ? "Resume" : "Hold recovery"}
              </p>
              {loan.status === "on_hold" ? (
                <ResumeForm loanId={loan.id} />
              ) : (
                <HoldForm loanId={loan.id} />
              )}
            </div>
            {user.role === "admin" && (
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-rust mb-2">Write off</p>
                <WriteOffForm loanId={loan.id} />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* foreclosure quote */}
      {loan.status !== "closed" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">To close today</span>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-end justify-between gap-4">
            <div className="text-sm text-ink-2">
              <p>
                Outstanding {formatINR(detail.foreclosure.outstandingPaise)}
                {detail.foreclosure.accruedInterestPaise > 0 &&
                  ` + accrued interest ${formatINR(detail.foreclosure.accruedInterestPaise)}`}
                {detail.foreclosure.chargePaise > 0 &&
                  ` + charge ${formatINR(detail.foreclosure.chargePaise)}`}
              </p>
              <p className="text-xs text-ink-3 mt-1">
                {detail.foreclosure.basis}
              </p>
            </div>
            <p className="font-display text-2xl font-semibold tnum">
              {formatINR(detail.foreclosure.totalPaise)}
            </p>
          </div>
        </Card>
      )}

      {/* schedule */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Repayment schedule</span>
          {nextDue && (
            <span className="text-xs font-medium text-ink-2">
              next due {MONTHS[nextDue.dueMonth - 1]} {nextDue.dueYear}
            </span>
          )}
        </div>
        <Table>
          <THead>
            {[
              "#",
              "Due",
              "Opening",
              "Interest",
              "Principal",
              "Instalment",
              "Closing",
              "Status",
            ].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {schedule.map((r) => (
              <TR
                key={r.id}
                className={r.id === nextDue?.id ? "bg-surface-2" : ""}
              >
                <TD className="font-mono tnum text-ink-3">
                  {r.instalmentNo}
                </TD>
                <TD className="whitespace-nowrap text-ink-2">
                  {MONTHS[r.dueMonth - 1]} {r.dueYear}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(r.openingPaise)}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(r.interestPaise)}
                </TD>
                <TD className="font-mono tnum">
                  {formatINR(r.principalPaise)}
                </TD>
                <TD className="font-mono tnum">
                  {formatINR(r.instalmentPaise)}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(r.closingPaise)}
                </TD>
                <TD>
                  <Badge tone={SCHEDULE_STATUS_TONE[r.status] ?? "neutral"}>
                    {r.status}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {/* ledger */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Ledger</span>
          <span
            className={`label ${detail.reconciles ? "text-teal" : "text-rust"}`}
          >
            {detail.reconciles ? "reconciles" : "does not reconcile"}
          </span>
        </div>
        <ul className="divide-y divide-line-2">
          {transactions.map((t) => (
            <li
              key={t.id}
              className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{TXN_LABEL[t.kind] ?? t.kind}</span>
                  <span className="text-ink-3 text-xs ml-2 font-mono">
                    {formatDate(t.at)}
                  </span>
                  {t.actor !== "system" && (
                    <span className="text-ink-3 text-xs ml-2">{t.actor}</span>
                  )}
                </p>
                <p className="text-xs text-ink-2 mt-0.5 max-w-[70ch]">{t.basis}</p>
              </div>
              <div className="text-right whitespace-nowrap">
                <span
                  className={`font-mono tnum text-sm ${
                    t.amountPaise < 0
                      ? "text-teal"
                      : t.amountPaise > 0
                        ? "text-ink"
                        : "text-ink-3"
                  }`}
                >
                  {t.amountPaise === 0
                    ? "—"
                    : `${t.amountPaise < 0 ? "−" : "+"} ${formatINR(Math.abs(t.amountPaise))}`}
                </span>
                <span className="block text-xs text-ink-3 font-mono tnum">
                  balance {formatINR(t.balanceAfterPaise)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
          The ledger is the record; the balance shown on the register is a cache
          of it. Every movement — including a write-off — stays visible here.
          {scheme &&
            ` Recovery stops before net pay falls below ${formatINR(scheme.minNetPayPaise)}.`}
        </p>
      </Card>
    </div>
  );
}
