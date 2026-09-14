# Lekha

Indian payroll and HRMS — employee master, attendance and leave, payroll runs
with statutory deductions, income tax, loans and advances, full-and-final
settlement, banking files, and an employee self-service portal.

## Requirements

- Node 20+
- A libSQL database ([Turso](https://turso.tech)) for any deployment. A local
  file is used automatically in development.

## Development

```bash
npm install
npm run db:push          # create the schema in ./data/lekha.db
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" \
  COMPANY_NAME="Your Company Private Limited" npm run db:bootstrap
npm run dev
```

`db:bootstrap` creates the first company and administrator and prints a
generated password once. There is no demo data and no default account.

## Configuration

Copy `.env.example` and fill it in. In production `DATABASE_URL` is required —
the app refuses to open a file-backed database there, because a serverless
filesystem does not survive a redeploy.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | libSQL/Turso URL. Required in production. |
| `DATABASE_AUTH_TOKEN` | Turso auth token. |
| `DATABASE_PATH` | Development only, when `DATABASE_URL` is unset. |
| `UPLOAD_ROOT` | Where uploaded documents are written. |

## Deploying to Vercel

1. Create a Turso database and set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
   in the Vercel project's environment variables.
2. Push the schema at it: `DATABASE_URL=… DATABASE_AUTH_TOKEN=… npm run db:push`
3. Deploy.
4. Bootstrap the first administrator against the same database:
   `DATABASE_URL=… DATABASE_AUTH_TOKEN=… ADMIN_EMAIL=… ADMIN_NAME=… COMPANY_NAME=… npm run db:bootstrap`

### Known blockers before real use

These are deliberate, documented gaps rather than oversights. Read them before
putting anyone's payroll in here.

- **Document storage is on the local filesystem.** `lib/storage/disk.ts` writes
  uploads to disk. On Vercel that disk is ephemeral, so every PAN card,
  cancelled cheque and investment proof is lost on the next deploy. This must
  move to object storage before documents are uploaded in production.
- **No email.** There is no password reset, no invitation and no notification.
  An administrator issues passwords from Settings → Accounts and hands them
  over directly.
- **Tax and statutory configuration is unverified.** `TAX_CONFIG_VERIFIED` is
  `false`; the ECR and ESIC return formats are also flagged unverified. The
  figures are development placeholders and have not been checked against the
  Finance Act or signed off by a chartered accountant.
- **Tax configuration covers FY 2026-27 only.** Tax cannot be computed in a
  financial year with no dated entry in `lib/tax/config.ts`. This is
  deliberate — silently reusing last year's slabs is worse than refusing.
- **Login throttling is in-process**, so it does not survive a restart or apply
  across instances. A shared store is needed for a real deployment.

## Commands

```bash
npm run dev              # development server
npm run build            # production build
npm run db:push          # apply the schema
npm run db:bootstrap     # create the first company and administrator
npx tsc --noEmit -p .    # typecheck
npx tsx --test "lib/**/*.test.ts"   # unit tests
npx eslint .             # lint
```

## Architecture notes

- **Money is always integer paise.** No floating point anywhere in a
  calculation that reaches a payslip.
- **Business logic is pure and tested**; `lib/` holds the rules, Server Actions
  are thin wrappers over them.
- **Historical figures are immutable.** An approved run is the figure of
  record; corrections are versioned revisions and arrears, never edits.
- **The audit and access logs are append-only**, enforced by database triggers
  rather than by application convention.
- **Every query is asynchronous**, including inside transactions. The
  type-aware `no-floating-promises` lint rule is load-bearing: an un-awaited
  write inside a transaction is one the commit does not wait for.
