"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses, type ButtonVariant, type ButtonSize } from "./button";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ComponentProps<"button"> & {
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonClasses(variant, size)} ${className}`}
      {...props}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
