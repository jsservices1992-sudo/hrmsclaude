import Link from "next/link";

export default function ConsoleNotFound() {
  return (
    <div className="mx-auto my-10 max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8 text-center">
      <p className="text-sm font-semibold text-indigo">404</p>
      <h1 className="text-2xl font-bold tracking-tight text-ink mt-2">Nothing here</h1>
      <p className="text-sm text-ink-2 mt-2">
        The record may have been removed, or the link belongs to a company you do not have access to.
      </p>
      <Link
        href="/console"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2 focus-visible:shadow-ring"
      >
        Go to Home
      </Link>
    </div>
  );
}
