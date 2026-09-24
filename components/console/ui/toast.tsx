"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Tone = "ok" | "error";
type Toast = { id: number; tone: Tone; message: string };
type ToastContextValue = { push: (tone: Tone, message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((tone: Tone, message: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "border-rust bg-rust-soft text-rust" : "border-teal bg-teal-soft text-teal"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
