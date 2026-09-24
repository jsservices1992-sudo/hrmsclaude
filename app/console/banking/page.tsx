import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/payroll/load";
import {
  loadPayments,
  loadBankFiles,
  loadPaymentStatus,
  loadStatutoryPayments,
  loadJournal,
  loadProvisions,
  FORMAT_LABELS,
  formatForBank,
  formatIsBankSpecific,
  APPROVED_STATUSES,
} from "@/lib/banking/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
  canMutate,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import type { Dimension } from "@/lib/banking/gl";
import {
  GenerateFileForm,
  ReleaseFileForm,
  PaymentStatusForm,
  ExportJournalForm,
  PostProvisionsForm,
} from "./forms";
import { PageHeader, Card, Select, Button, FilterBar, FilterField, Badge, type BadgeTone, StatCard, Table, THead, TH, TBody, TR, TD, MonthNav } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Bank & accounting" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "none", label: "No split" },
  { value: "branch", label: "By branch" },
  { value: "department", label: "By department" },
  { value: "cost_centre", label: "By cost centre" },
];

const FILE_STATUS_TONE: Record<string, BadgeTone> = {
  superseded: "rust",
  released: "teal",
  active: "neutral",
};

const INSTRUCTION_STATUS_TONE: Record<string, BadgeTone> = {
  paid: "teal",
  pending: "neutral",
};

function Panel({
  title,
  right,
  children,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {right}
      </div>
      {children}
    </Card>
  );
}

function Notice({
  items,
  tone,
  label,
}: {
  items: string[];
  tone: "brass" | "rust";
  label: string;
}) {
  if (items.length === 0) return null;
  const unique = [...new Set(items)];
  return (
    <div
      className={`border-2 px-5 py-4 ${
        tone === "rust" ? "border-rust bg-rust-soft" : "border-amber bg-amber-soft"
      }`}
    >
      <p className={`label mb-1.5 ${tone === "rust" ? "text-rust" : "text-amber"}`}>
        {label}
      </p>
      <ul className="text-sm text-ink-2 max-w-[76ch] flex flex-col gap-1">
        {unique.slice(0, 8).map((w, i) => (
          <li key={i}>· {w}</li>
        ))}
        {unique.length > 8 && (
          <li className="text-ink-3">· and {unique.length - 8} more</li>
        )}
      </ul>
    </div>
  );
}

export default async function BankingPage(props: PageProps<"/console/banking">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=banking");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;
  const dimension = (typeof sp.dimension === "string" ? sp.dimension : "none") as Dimension;

  const company = companies.find((c) => c.id === companyId)!;
  const payments = await loadPayments({ companyId, year, month });
  const statutory = await loadStatutoryPayments({ companyId, year, month });
  const journalData = await loadJournal({ companyId, year, month, dimension });
  const provisions = await loadProvisions({ companyId, year, month });
  const files = payments ? await loadBankFiles(payments.run.id) : [];

  const activeFile = files.find((f) => f.status === "active" || f.status === "released");
  const instructions = activeFile ? await loadPaymentStatus(activeFile.id) : [];

  await recordAccess({
    user,
    dataClass: "bank",
    surface: "console/banking",
    companyId,
    rowCount: payments?.paymentRun.instructions.length ?? 0,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });

  const period = `${year}-${String(month).padStart(2, "0")}`;
  const query = `company=${companyId}&year=${year}&month=${month}`;
  const canAct = canMutate(user);
  const approved = payments ? APPROVED_STATUSES.has(payments.run.status) : false;

  const failed = instructions.filter(
    (i) => i.status === "failed" || i.status === "returned",
  );
  const pending = instructions.filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Banking & accounting"
        title="Bank & accounting"
        description={
          <>
            {company.name}
            {payments
              ? ` · run version ${payments.run.version}, ${payments.run.status.replace(/_/g, " ")}`
              : " · no payroll run for this period"}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <MonthNav
            year={year}
            month={month}
            href={(y, m) => `/console/banking?company=${companyId}&dimension=${dimension}&year=${y}&month=${m}`}
          />
          <FilterBar
            action="/console/banking"
            mode="switch"
            hidden={companies.length > 1 ? undefined : { company: companyId }}
          >
            {companies.length > 1 && (
              <input type="hidden" name="company" value={companyId} />
            )}
            <input type="hidden" name="month" value={month} />
            <input type="hidden" name="year" value={year} />
            <FilterField label="Split" showLabel={false}>
              <Select name="dimension" defaultValue={dimension}>
                {DIMENSIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
          </div>
        }
      />

      {!payments && (
        <Card padded={false} className="px-5 py-6">
          <p className="text-sm text-ink-2 max-w-[70ch]">
            No payroll run exists for {MONTHS[month - 1]} {year}. Bank files and
            journals are produced from a saved run, so there is nothing to
            disburse or post.
          </p>
        </Card>
      )}

      {payments && (
        <>
          <Notice items={payments.warnings} tone="brass" label="Before you release money" />
          {payments.paymentRun.blocked.length > 0 && (
            <Notice
              items={payments.paymentRun.blocked.map(
                (b) => `${b.empCode}: ${b.reason}`,
              )}
              tone="rust"
              label="Cannot be paid"
            />
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                l: "To disburse",
                v: formatINR(payments.paymentRun.electronicTotalPaise),
              },
              {
                l: "Instructions",
                v: `${payments.paymentRun.instructions.length}`,
              },
              {
                l: "Same bank / other",
                v: `${payments.paymentRun.sameBankCount} / ${payments.paymentRun.interBankCount}`,
              },
              {
                l: "Cash & cheque",
                v: formatINR(payments.paymentRun.nonElectronicTotalPaise),
              },
            ].map((x) => (
              <StatCard key={x.l} label={x.l} value={x.v} />
            ))}
          </div>

          {/* ---------- salary disbursement ---------- */}
          <Panel
            title="Salary disbursement"
            right={
              <span
                className={`label ${payments.reconciliation.matches ? "text-teal" : "text-rust"}`}
              >
                {payments.reconciliation.matches
                  ? "agrees with the register"
                  : "does not agree"}
              </span>
            }
          >
            <div className="px-4 py-3 border-b border-line-2 text-sm text-ink-2">
              {payments.disbursingAccount ? (
                <p>
                  From {payments.disbursingAccount.bankName} ·{" "}
                  <span className="font-mono">
                    {payments.disbursingAccount.accountNumber}
                  </span>{" "}
                  · format{" "}
                  {FORMAT_LABELS[formatForBank(payments.disbursingAccount.fileFormat)]}
                  {!formatIsBankSpecific(payments.disbursingAccount.fileFormat) && (
                    <span className="text-amber">
                      {" "}
                      — no layout is built for{" "}
                      {payments.disbursingAccount.fileFormat}, so the generic
                      format is used
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-rust">No salary account configured.</p>
              )}
              <p className="text-xs text-ink-3 mt-1">
                {payments.reconciliation.note}
              </p>
            </div>

            {canAct && approved && payments.disbursingAccount && (
              <div className="px-4 py-3 border-b border-line-2">
                <GenerateFileForm
                  companyId={companyId}
                  year={year}
                  month={month}
                  defaultValueDate={`${period}-28`}
                  hasOutstanding={files.some((f) => f.status === "active")}
                />
              </div>
            )}

            {files.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">
                No file has been generated for this run.
              </p>
            ) : (
              <ul className="divide-y divide-line-2">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-mono">{f.reference}</span>
                        <span className="text-ink-3 ml-2">
                          {f.lineCount} lines · {formatINR(f.totalPaise)}
                        </span>
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5">
                        {f.format} · value {formatDate(f.valueDate)} · {f.generatedBy} ·{" "}
                        {formatDate(f.generatedAt)}
                        {f.supersededReason && (
                          <span className="text-rust"> · {f.supersededReason}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={FILE_STATUS_TONE[f.status] ?? "neutral"}>
                        {f.status}
                      </Badge>
                      {f.status === "active" && (
                        <>
                          <a
                            href={`/console/banking/download/bank-file?${query}&valueDate=${f.valueDate}`}
                            className="text-sm font-semibold text-indigo hover:text-indigo-2"
                          >
                            Download ↓
                          </a>
                          {canAct && (
                            <ReleaseFileForm companyId={companyId} fileId={f.id} />
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {payments.paymentRun.nonElectronic.length > 0 && (
              <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
                {payments.paymentRun.nonElectronic.length} employee(s) are paid by
                cash or cheque and are deliberately not in the electronic file.
                They appear on the{" "}
                <a
                  href={`/console/banking/download/payment-register?${query}`}
                  className="text-indigo font-semibold hover:text-indigo-2"
                >
                  payment register
                </a>
                .
              </p>
            )}
          </Panel>

          {/* ---------- payment status ---------- */}
          {instructions.length > 0 && (
            <Panel
              title="Payment status"
              right={
                failed.length > 0 ? (
                  <span className="text-xs font-semibold text-rust">{failed.length} failed</span>
                ) : (
                  <span className="text-xs font-medium text-ink-2">
                    {pending.length} awaiting the bank
                  </span>
                )
              }
            >
              {failed.length > 0 && (
                <p className="px-4 py-2.5 text-xs text-rust border-b border-line-2 max-w-[78ch]">
                  {formatINR(failed.reduce((a, i) => a + i.amountPaise, 0))} failed
                  and is still owed. It is held as a liability and re-queued into
                  the next run once the account details are corrected — it is not
                  written off.
                </p>
              )}
              <ul className="divide-y divide-line-2 max-h-[28rem] overflow-y-auto">
                {instructions.slice(0, 40).map((i) => (
                  <li
                    key={i.id}
                    className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">
                        {i.name}
                        <span className="font-mono text-xs text-ink-3 ml-2">
                          {i.empCode}
                        </span>
                        <span className="font-mono tnum text-xs text-ink-2 ml-2">
                          {formatINR(i.amountPaise)}
                        </span>
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5">
                        <span className="font-mono">
                          {i.accountNumber.slice(0, 4)}…{i.accountNumber.slice(-4)}
                        </span>{" "}
                        · {i.ifsc} · {i.sameBank ? "internal" : "interbank"}
                        {i.failureReason && (
                          <span className="text-rust"> · {i.failureReason}</span>
                        )}
                      </p>
                    </div>
                    {i.status === "pending" && canAct ? (
                      <PaymentStatusForm
                        companyId={companyId}
                        instructionId={i.id}
                      />
                    ) : (
                      <Badge tone={INSTRUCTION_STATUS_TONE[i.status] ?? "rust"}>
                        {i.status}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
              {instructions.length > 40 && (
                <p className="px-4 py-2 text-xs text-ink-3 border-t border-line-2">
                  Showing 40 of {instructions.length}.
                </p>
              )}
            </Panel>
          )}
        </>
      )}

      {/* ---------- statutory payments ---------- */}
      {statutory.length > 0 && (
        <Panel title="Statutory remittances">
          <Table>
            <THead>
              {["Remittance", "From account", "Settles", "Amount"].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {statutory.map((p) => (
                <TR key={p.purpose}>
                  <TD>{p.label}</TD>
                  <TD className="text-ink-2">
                    {p.account ? (
                      <>
                        {p.account.bankName}{" "}
                        <span className="font-mono text-xs">
                          {p.account.accountNumber.slice(-6)}
                        </span>
                      </>
                    ) : (
                      <span className="text-rust text-xs">
                        No account configured — pay manually
                      </span>
                    )}
                  </TD>
                  <TD className="text-xs text-ink-3">
                    {p.filingKind.replace(/_/g, " ")}
                  </TD>
                  <TD className="font-mono tnum">
                    {formatINR(p.amountPaise)}
                  </TD>
                </TR>
              ))}
              <TR className="bg-surface-2">
                <TD className="font-medium" colSpan={3}>
                  Total to remit
                </TD>
                <TD className="font-mono tnum font-semibold">
                  {formatINR(statutory.reduce((a, p) => a + p.amountPaise, 0))}
                </TD>
              </TR>
            </TBody>
          </Table>
        </Panel>
      )}

      {/* ---------- journal ---------- */}
      {journalData && (
        <>
          <Notice
            items={journalData.journal.warnings}
            tone={journalData.journal.balanced ? "brass" : "rust"}
            label={journalData.journal.balanced ? "Before you post" : "Do not post this"}
          />

          <Panel
            title={`Journal voucher · ${DIMENSIONS.find((d) => d.value === dimension)?.label}`}
            right={
              <span
                className={`label ${journalData.journal.balanced ? "text-teal" : "text-rust"}`}
              >
                {journalData.journal.balanced
                  ? "balanced"
                  : `out by ${formatINR(Math.abs(journalData.journal.differencePaise))}`}
              </span>
            }
          >
            {journalData.chart.isDefault && (
              <p className="px-4 py-2 text-xs text-amber border-b border-line-2">
                Using the shipped default chart of accounts. Map it to the
                customer&rsquo;s own ledger before anyone posts from it.
              </p>
            )}
            <Table>
              <THead>
                {["Account", "Dimension", "Debit", "Credit"].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </THead>
              <TBody>
                {journalData.journal.lines.map((l, i) => (
                  <TR key={`${l.accountCode}-${l.dimension}-${i}`}>
                    <TD>
                      {l.accountName}
                      <span className="block font-mono text-xs text-ink-3">
                        {l.accountCode}
                      </span>
                    </TD>
                    <TD className="text-ink-2">{l.dimension}</TD>
                    <TD className="font-mono tnum">
                      {l.debitPaise > 0 ? formatINR(l.debitPaise) : ""}
                    </TD>
                    <TD className="font-mono tnum">
                      {l.creditPaise > 0 ? formatINR(l.creditPaise) : ""}
                    </TD>
                  </TR>
                ))}
                <TR className="bg-surface-2">
                  <TD className="font-medium" colSpan={2}>
                    Total
                  </TD>
                  <TD className="font-mono tnum font-semibold">
                    {formatINR(journalData.journal.totalDebitPaise)}
                  </TD>
                  <TD className="font-mono tnum font-semibold">
                    {formatINR(journalData.journal.totalCreditPaise)}
                  </TD>
                </TR>
              </TBody>
            </Table>
            <div className="px-4 py-3 border-t border-line-2 flex flex-wrap items-center gap-3">
              <Button
                href={`/console/banking/download/journal-csv?${query}&dimension=${dimension}`}
                size="sm"
              >
                Journal CSV ↓
              </Button>
              <Button
                href={`/console/banking/download/tally-xml?${query}&dimension=${dimension}`}
                size="sm"
              >
                Tally XML ↓
              </Button>
              {canAct && journalData.journal.balanced && (
                <ExportJournalForm
                  companyId={companyId}
                  year={year}
                  month={month}
                  dimension={dimension}
                />
              )}
            </div>
          </Panel>
        </>
      )}

      {/* ---------- provisions ---------- */}
      {provisions && (
        <>
          <Notice items={provisions.warnings} tone="brass" label="On the provisions" />
          <Panel
            title="Provisions & accruals"
            right={
              <span className="text-xs font-medium text-ink-2 tnum">
                charge {formatINR(provisions.totalChargePaise)}
              </span>
            }
          >
            <Table>
              <THead>
                {["Provision", "Opening", "Closing", "Charge this month"].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </THead>
              <TBody>
                {[provisions.gratuity, provisions.leave, provisions.bonus].map((p) => (
                  <TR key={p.kind}>
                    <TD>
                      {p.label}
                      <span className="block text-xs text-ink-3">
                        {p.lines.length} employees
                      </span>
                    </TD>
                    <TD className="font-mono tnum text-ink-2">
                      {formatINR(p.openingPaise)}
                    </TD>
                    <TD className="font-mono tnum">
                      {formatINR(p.closingPaise)}
                    </TD>
                    <TD
                      className={`font-mono tnum ${
                        p.isRelease ? "text-teal" : ""
                      }`}
                    >
                      {p.isRelease ? "− " : ""}
                      {formatINR(Math.abs(p.chargePaise))}
                      {p.isRelease && (
                        <span className="block text-xs text-ink-3">release</span>
                      )}
                    </TD>
                  </TR>
                ))}
                <TR className="bg-surface-2">
                  <TD className="font-medium">Total liability carried</TD>
                  <TD />
                  <TD className="font-mono tnum font-semibold">
                    {formatINR(provisions.totalLiabilityPaise)}
                  </TD>
                  <TD className="font-mono tnum font-semibold">
                    {formatINR(provisions.totalChargePaise)}
                  </TD>
                </TR>
              </TBody>
            </Table>
            <div className="px-4 py-3 border-t border-line-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-3 max-w-[62ch]">
                Gratuity accrues from the first month, not from the fifth year, so
                a cohort crossing the qualifying period does not land as a single
                charge. Posting freezes these balances as next month&rsquo;s
                opening.
              </p>
              {canAct && (
                <PostProvisionsForm companyId={companyId} year={year} month={month} />
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
