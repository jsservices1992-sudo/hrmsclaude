"use client";

import { useActionState, useState } from "react";
import {
  createApiKey,
  revokeApiKey,
  createWebhookSubscription,
  toggleWebhookSubscription,
  type ApiAdminState,
} from "./actions";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/signing";
import { Input, SubmitButton, Button } from "@/components/console/ui";

/**
 * A secret is shown exactly once, right after it is created — there is no
 * "reveal again" because the server never stores the plaintext. Copy it
 * now or generate a new one.
 */
function Reveal({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="border border-amber/50 bg-amber-soft px-3 py-2.5 flex flex-col gap-2 rounded-lg">
      <p className="text-xs font-medium text-ink-1">
        {label} — shown once. Copy it now; it cannot be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-2 py-1.5 text-xs bg-surface border border-line font-mono break-all rounded-lg">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            /* Clipboard access is refused outside a secure context and
               when the user denies it, so a rejection is a real case,
               not a theoretical one — say nothing happened rather than
               showing "Copied" over an empty clipboard. */
            navigator.clipboard.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => setFailed(true),
            );
          }}
          className="shrink-0"
        >
          {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Feedback({ state }: { state: ApiAdminState }) {
  return (
    <>
      {state.error && <p className="text-xs text-rust">{state.error}</p>}
      {state.ok && !state.reveal && <p className="text-xs text-teal">{state.ok}</p>}
      {state.reveal && <Reveal label={state.reveal.label} value={state.reveal.value} />}
    </>
  );
}

export function CreateApiKeyForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<ApiAdminState, FormData>(createApiKey, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Label</span>
          <Input name="label" placeholder="e.g. Payroll integration" required />
        </label>
        <label className="flex items-center gap-2 text-sm pb-1.5">
          <input type="checkbox" name="canSeeCompensation" />
          Can read pay figures
        </label>
        <SubmitButton size="sm" pendingText="Working…">Create key</SubmitButton>
      </div>
      <p className="text-xs text-ink-3 max-w-[70ch]">
        Read-only. Without this checked, the key can read employees, leave and
        run metadata, but every pay figure comes back masked — the same rule
        that governs a console role with no compensation scope.
      </p>
      <Feedback state={state} />
    </form>
  );
}

export function RevokeApiKeyForm({ id }: { id: string }) {
  const [state, action] = useActionState<ApiAdminState, FormData>(revokeApiKey, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="text-rust" pendingText="Working…">Revoke</SubmitButton>
      {state.error && <p className="text-xs text-rust">{state.error}</p>}
    </form>
  );
}

export function CreateWebhookForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<ApiAdminState, FormData>(createWebhookSubscription, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Endpoint URL (HTTPS)</span>
        <Input
          name="url"
          type="url"
          placeholder="https://example.com/hooks/lekha"
          required
          className="w-full max-w-lg"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Events</span>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`event_${e}`} />
              <code className="text-xs">{e}</code>
            </label>
          ))}
        </div>
      </div>
      <div>
        <SubmitButton size="sm" pendingText="Working…">Create subscription</SubmitButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function ToggleWebhookForm({ id, active }: { id: string; active: boolean }) {
  const [state, action] = useActionState<ApiAdminState, FormData>(toggleWebhookSubscription, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" pendingText="Working…">
        {active ? "Pause" : "Resume"}
      </SubmitButton>
      {state.error && <p className="text-xs text-rust">{state.error}</p>}
    </form>
  );
}
