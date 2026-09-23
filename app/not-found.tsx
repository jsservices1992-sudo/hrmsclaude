import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center bg-paper px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-indigo">404</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink mt-2">Page not found</h1>
        <p className="text-ink-2 mt-3">The address may be mistyped, or the page has moved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="inline-flex rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2">
            Go to the homepage
          </Link>
          <Link href="/login" className="inline-flex rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
