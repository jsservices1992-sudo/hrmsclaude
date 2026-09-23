export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-line bg-surface ${className}`}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-surface-2 border-b border-line">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-xs font-semibold text-left text-ink-2 px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</th>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line-2">{children}</tbody>;
}

export function TR({
  children,
  className = "",
  ...props
}: React.ComponentProps<"tr">) {
  return (
    <tr className={`hover:bg-surface-2/60 transition-colors ${className}`} {...props}>
      {children}
    </tr>
  );
}

export function TD({
  children,
  className = "",
  ...props
}: React.ComponentProps<"td">) {
  return (
    <td className={`px-3 py-2.5 whitespace-nowrap ${className}`} {...props}>
      {children}
    </td>
  );
}
