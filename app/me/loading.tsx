import { PageSkeleton } from "@/components/console/ui";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <PageSkeleton />
    </div>
  );
}
