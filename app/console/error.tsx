"use client";

import { ErrorPanel } from "@/components/console/error-panel";

export default function ConsoleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} homeHref="/console" homeLabel="Go to Home" />;
}
