import { notFound } from "next/navigation";
import { loadJoinerByToken } from "@/lib/onboarding/load";
import { formatINR } from "@/lib/payroll/money";
import { SITE } from "@/lib/site";
import { AcceptOfferForm, ProfileForm } from "./portal-form";
import { formatDate } from "@/lib/format/date";

export const metadata = {
  title: "Welcome",
  // A tokenised link must never be indexed.
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function JoinerPortalPage(
  props: PageProps<"/join/[token]">,
) {
  const { token } = await props.params;
  const data = await loadJoinerByToken(token);

  // An invalid, expired or already-used token is indistinguishable — we do
  // not reveal whether a joiner exists behind it.
  if (!data) {
    return (
      <div className="min-h-screen grid place-items-center px-5">
        <div className="max-w-md text-center flex flex-col gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center bg-indigo text-on-indigo font-display text-xl font-semibold mx-auto">
            ल
          </span>
          <h1 className="font-display text-2xl font-semibold">This link is not active</h1>
          <p className="text-ink-2">
            It may have expired, or your onboarding may already be complete.
            Please contact your HR representative for a new link.
          </p>
        </div>
      </div>
    );
  }

  const { joiner: j, company, documents } = data;
  const mandatory = documents.filter((d) => d.mandatory);
  const verified = mandatory.filter((d) => d.status === "verified").length;

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-8">
          <div className="flex items-center gap-2.5 mb-6">
            <span aria-hidden className="grid h-8 w-8 place-items-center bg-indigo text-on-indigo font-display text-lg font-semibold leading-none">
              ल
            </span>
            <span className="font-display text-xl font-semibold">{SITE.name}</span>
          </div>
          <p className="label text-brass">Welcome</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold mt-2 tracking-[-0.02em]">
            Hello {j.firstName}
          </h1>
          <p className="text-ink-2 mt-2 max-w-[58ch] leading-relaxed">
            {company.name} is getting things ready for you. Filling this in
            before your first day means your salary, provident fund and tax are
            set up correctly from day one — and you will not be chased for
            paperwork in your first week.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-8 flex flex-col gap-8">
        <div className="border border-line bg-surface flex flex-wrap rounded-lg">
          {[
            { l: "Role", v: j.designation ?? "—" },
            { l: "Starting", v: j.proposedDoj },
            { l: "Annual CTC", v: j.offeredCtcPaise ? formatINR(j.offeredCtcPaise) : "—" },
          ].map((x) => (
            <div key={x.l} className="px-4 py-3 border-r border-line last:border-r-0 flex-1 min-w-[9rem]">
              <div className="label text-ink-3">{x.l}</div>
              <div className="font-mono text-sm tnum mt-1">{x.v}</div>
            </div>
          ))}
        </div>

        {j.offerStatus === "sent" && (
          <section className="border-2 border-indigo bg-surface p-5 flex flex-col gap-3 rounded-lg">
            <h2 className="font-display text-xl font-semibold">Your offer</h2>
            <p className="text-sm text-ink-2">
              Accepting confirms you intend to join on {formatDate(j.proposedDoj)}. Your
              acceptance is recorded with a timestamp.
            </p>
            <AcceptOfferForm token={token} />
          </section>
        )}

        {j.offerStatus === "accepted" && (
          <div className="border border-teal/40 bg-teal-soft px-4 py-3 text-sm text-teal rounded-lg">
            Offer accepted{j.offerRespondedAt ? ` on ${formatDate(j.offerRespondedAt)}` : ""}. Thank you.
          </div>
        )}

        {j.profileSubmittedAt && (
          <div className="border border-line bg-surface px-4 py-3 text-sm text-ink-2 rounded-lg">
            <span className="label text-ink-3">Saved</span> — you submitted these
            details on {formatDate(j.profileSubmittedAt)}. You can update them
            until your first day.
          </div>
        )}

        <ProfileForm
          token={token}
          values={{
            dateOfBirth: j.dateOfBirth,
            gender: j.gender,
            addressLine: j.addressLine,
            city: j.city,
            pincode: j.pincode,
            mobile: j.mobile,
            emergencyContactName: j.emergencyContactName,
            emergencyContactPhone: j.emergencyContactPhone,
            pan: j.pan,
            uan: j.uan,
            bankAccount: j.bankAccount,
            ifsc: j.ifsc,
            hadPriorPfMembership: j.hadPriorPfMembership,
          }}
        />

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold">Documents we need</h2>
          <p className="text-sm text-ink-2">
            {verified} of {mandatory.length} required documents are verified.
            Upload is not available in this build — your HR contact will collect
            these directly.
          </p>
          <ul className="border border-line bg-surface divide-y divide-line-2 rounded-lg">
            {documents.map((d) => (
              <li key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm">
                  {d.label}
                  {d.mandatory && <span className="text-rust ml-1">*</span>}
                  {d.rejectionReason && (
                    <span className="block text-xs text-rust mt-0.5">
                      Please resend: {d.rejectionReason}
                    </span>
                  )}
                </span>
                <span className={`label px-1.5 py-0.5 shrink-0 ${
                  d.status === "verified" ? "bg-teal-soft text-teal"
                    : d.status === "rejected" ? "bg-rust-soft text-rust"
                    : "bg-surface-2 text-ink-3"
                }`}>
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-ink-3 border-t border-line pt-5">
          This is a private link for you. Do not share it — anyone with the link
          can see and change these details.
        </p>
      </main>
    </div>
  );
}
