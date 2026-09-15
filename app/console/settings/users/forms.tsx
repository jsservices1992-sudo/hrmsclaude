"use client";

import { useActionState, useState } from "react";
import {
  createUser,
  updateUser,
  resetUserPassword,
  endUserSessions,
  type UserAdminState,
} from "./actions";
import { ASSIGNABLE_ROLES, SCOPE_LABELS, SCOPE_FOR_ROLE } from "@/lib/auth/user-admin";
import { Input, Select, SubmitButton } from "@/components/console/ui";

type Option = { id: string; label: string };

function Feedback({ state }: { state: UserAdminState }) {
  return (
    <div className="flex flex-col gap-2">
      {state.error && <p className="text-xs text-rust max-w-[70ch]">{state.error}</p>}
      {state.ok && <p className="text-xs text-teal max-w-[70ch]">{state.ok}</p>}
      {state.password && (
        <div className="border-2 border-brass bg-brass-soft px-3 py-2.5 max-w-[46ch]">
          <p className="label text-brass">Password — shown once</p>
          <p className="font-mono text-base mt-1 select-all break-all">{state.password}</p>
          <p className="text-xs text-ink-2 mt-1.5">
            Give this to them over a channel you trust. It is not stored in
            readable form and cannot be shown again — issue a new one if it is
            lost.
          </p>
        </div>
      )}
    </div>
  );
}

function Fields({
  companies,
  employees,
  editing,
}: {
  companies: Option[];
  employees: Option[];
  editing?: {
    name: string; role: string; companyId: string | null;
    employeeId: string | null; compensationScope: string; active: boolean;
  };
}) {
  const [role, setRole] = useState(editing?.role ?? "hr_manager");
  const [scope, setScope] = useState(
    editing?.compensationScope ?? SCOPE_FOR_ROLE.hr_manager,
  );

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="name" required defaultValue={editing?.name} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Role</span>
          <Select
            name="role"
            value={role}
            onChange={(e) => {
              const next = e.target.value;
              setRole(next);
              /* The scope follows the role until somebody chooses
                 otherwise. A payroll manager created with no pay access
                 can sign in and reach none of the screens the role
                 exists for, which reads as the account being broken. */
              setScope(SCOPE_FOR_ROLE[next] ?? scope);
            }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label} — {r.note}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Pay data they may see</span>
          <Select
            name="compensationScope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {SCOPE_LABELS.map((s) => (
              <option key={s.scope} value={s.scope}>{s.label}</option>
            ))}
          </Select>
          <span className="text-xs text-ink-3">
            {role === "payroll_manager"
              ? "Payroll screens — runs, registers, settlements — all need this company's pay."
              : role === "employee"
                ? "Their own payslip only. Anything wider lets them read colleagues' pay."
                : "Separate from the role: what this person may see, not what they may do."}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Company</span>
          <Select name="companyId" defaultValue={editing?.companyId ?? ""}>
            <option value="">Every company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Linked employee</span>
          <Select name="employeeId" defaultValue={editing?.employeeId ?? ""}>
            <option value="">Not linked</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm pt-5">
          <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />
          Can sign in
        </label>
      </div>
      <p className="text-xs text-ink-3 max-w-[80ch]">
        An employee account must be linked to a record — that link is what
        self-service checks before showing anyone their own pay. Leave the
        company blank only for people who genuinely work across every entity.
      </p>
    </>
  );
}

export function CreateUserForm({
  companies,
  employees,
}: {
  companies: Option[];
  employees: Option[];
}) {
  const [state, action] = useActionState<UserAdminState, FormData>(createUser, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 max-w-sm">
        <span className="label text-ink-3">Work email</span>
        <Input name="email" type="email" required placeholder="name@company.com" />
      </label>
      <Fields companies={companies} employees={employees} />
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Creating…">Create account</SubmitButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function EditUserForm({
  userId,
  companies,
  employees,
  editing,
}: {
  userId: string;
  companies: Option[];
  employees: Option[];
  editing: {
    name: string; role: string; companyId: string | null;
    employeeId: string | null; compensationScope: string; active: boolean;
  };
}) {
  const [state, action] = useActionState<UserAdminState, FormData>(updateUser, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <Fields companies={companies} employees={employees} editing={editing} />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action] = useActionState<UserAdminState, FormData>(resetUserPassword, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <button className="text-xs text-ink-3 hover:text-brass text-left">
        Issue a new password
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function EndSessionsForm({ userId }: { userId: string }) {
  const [state, action] = useActionState<UserAdminState, FormData>(endUserSessions, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <button className="text-xs text-ink-3 hover:text-rust text-left">
        Sign them out everywhere
      </button>
      <Feedback state={state} />
    </form>
  );
}
