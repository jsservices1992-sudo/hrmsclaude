"use client";

import { ErrorPanel } from "@/components/console/error-panel";

export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="px-4">
      <ErrorPanel error={error} retry={retry} homeHref="/me" homeLabel="Back to my page" />
    </div>
  );
}
