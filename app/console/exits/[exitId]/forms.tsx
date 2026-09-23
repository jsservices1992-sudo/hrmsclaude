"use client";

import { useActionState } from "react";
import { uploadExitDocument, type DocumentState } from "@/app/console/employees/documents";
import { Button, FormFeedback, FileDrop } from "@/components/console/ui";

export function UploadExitDocumentForm({
  employeeId,
  exitId,
  docType,
}: {
  employeeId: string;
  exitId: string;
  docType: string;
}) {
  const [state, action] = useActionState<DocumentState, FormData>(uploadExitDocument, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="exitId" value={exitId} />
      <input type="hidden" name="docType" value={docType} />
      <FileDrop compact name="file" accept="application/pdf,image/jpeg,image/png" />
      <Button type="submit" size="sm" className="text-xs hover:border-indigo hover:text-indigo">
        Upload
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
