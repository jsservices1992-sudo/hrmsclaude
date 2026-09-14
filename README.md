# Lekha

Indian payroll and HRMS — employee master, attendance and leave, payroll runs
with statutory deductions, income tax, loans and advances, full-and-final
settlement, banking files, and an employee self-service portal.

## Requirements

- Node 20+
- A PostgreSQL database. [Render](https://render.com) is what these
  instructions assume; any managed Postgres works.

## Development

```bash
npm install
# a local Postgres, e.g. docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"
npm run db:push && npm run db:triggers
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" \
  COMPANY_NAME="Your Company Private Limited" npm run db:bootstrap
npm run dev
```

`db:bootstrap` creates the first company and administrator and prints a
generated password once. There is no demo data and no default account.

Alternatively, visit `/signup` and register a company through the browser.
Registration is open unless `SIGNUP_ENABLED=false` is set — switch it off on a
single-company install, where a public page that mints administrators is not
something you want.

## Configuration

Copy `.env.example` and fill it in. In production `DATABASE_URL` is required —
the app refuses to open a file-backed database there, because a serverless
filesystem does not survive a redeploy.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Required everywhere. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store. Required in production. |
| `UPLOAD_ROOT` | Development only, when the Blob store is unset. |
| `SIGNUP_ENABLED` | Set to `false` to close self-serve registration. |

## Deploying to Vercel

1. Create a PostgreSQL database on Render, then copy its **External
   Database URL** into the Vercel project as `DATABASE_URL`. The internal
   URL only resolves inside Render's own network.
2. Connect a Vercel Blob store to the project; it sets
   `BLOB_READ_WRITE_TOKEN` for you.
3. Push the schema at it, from your machine:
   `DATABASE_URL=… npm run db:push && npm run db:triggers`
   — `db:push` creates tables but not the triggers that keep the audit
   log append-only.
   (`drizzle.config.ts` switches to the Turso dialect when `DATABASE_URL`
   is set, and uses a local file otherwise.)
4. Deploy.
5. Bootstrap the first administrator against the same database:
   `DATABASE_URL=… ADMIN_EMAIL=… ADMIN_NAME=… COMPANY_NAME=… npm run db:bootstrap`

### If a deployment comes up blank

`GET /api/health` reports which piece is missing — whether the database and
Blob store are configured, whether the database answers, and whether the
schema has been pushed at it. It reports presence, never values.

A 500 on sign-in or registration with pages that otherwise render is almost
always an unset `DATABASE_URL`: the pages do not touch the database until
something is submitted.

### Known blockers before real use

These are deliberate, documented gaps rather than oversights. Read them before
putting anyone's payroll in here.

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

- **Money is always integer paise, stored as `bigint`.** No floating point
  anywhere in a calculation that reaches a payslip — and not 32-bit
  `integer` either, which caps at about ₹2.14 crore and would wrap
  silently on a large annual total.
- **Business logic is pure and tested**; `lib/` holds the rules, Server Actions
  are thin wrappers over them.
- **Historical figures are immutable.** An approved run is the figure of
  record; corrections are versioned revisions and arrears, never edits.
- **The audit and access logs are append-only**, enforced by database triggers
  rather than by application convention.
- **Every query is asynchronous**, including inside transactions. The
  type-aware `no-floating-promises` lint rule is load-bearing: an un-awaited
  write inside a transaction is one the commit does not wait for.
