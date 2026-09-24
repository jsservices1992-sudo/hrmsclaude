"use client";

import { useActionState } from "react";
import { changeMyPassword, type AccountState } from "./actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

export function ChangePasswordForm() {
  const [state, action] = useActionState<AccountState, FormData>(changeMyPassword, {});
  return (
    <form action={action} className="flex flex-col gap-3 max-w-sm">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Current password</span>
        <Input name="currentPassword" type="password" required autoComplete="current-password" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">New password</span>
        <Input name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
        <span className="text-xs text-ink-3">
          At least 12 characters, and not your name, email or the company&apos;s.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Type it again</span>
        <Input name="confirmPassword" type="password" required autoComplete="new-password" />
      </label>
      <div>
        <SubmitButton pendingText="Changing…">Change password</SubmitButton>
      </div>
      <p className="text-xs text-ink-3 max-w-[60ch]">
        Every other session is signed out when the password changes — that is
        the point of changing it.
      </p>
      <FormFeedback state={state} />
    </form>
  );
}
