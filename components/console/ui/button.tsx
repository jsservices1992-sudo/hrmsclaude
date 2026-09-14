import Link from "next/link";

export type ButtonVariant = "primary" | "default" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export function buttonClasses(variant: ButtonVariant = "default", size: ButtonSize = "md") {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-base disabled:opacity-50 disabled:pointer-events-none";
  const sizes: Record<ButtonSize, string> = {
    sm: "px-2.5 py-1.5 text-xs",
    md: "px-3.5 py-2 text-sm",
  };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-indigo text-on-indigo hover:bg-indigo-2",
    default: "border border-line bg-surface text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
    danger: "border border-rust text-rust hover:bg-rust-soft",
  };
  return `${base} ${sizes[size]} ${variants[variant]}`;
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
};

type ButtonAsLink = CommonProps & {
  href: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className">;

type ButtonAsButton = CommonProps &
  Omit<React.ComponentProps<"button">, "className"> & { href?: undefined };

export function Button(props: ButtonAsLink | ButtonAsButton) {
  const { variant, size, className = "", children, ...rest } = props;
  const classes = `${buttonClasses(variant, size)} ${className}`;

  if ("href" in props && props.href !== undefined) {
    const { href, ...linkRest } = rest as ButtonAsLink;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {children}
      </Link>
    );
  }

  const buttonRest = rest as ButtonAsButton;
  return (
    <button type={buttonRest.type ?? "button"} className={classes} {...buttonRest}>
      {children}
    </button>
  );
}
