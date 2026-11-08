"use client";

import { forwardRef } from "react";

// Shared building blocks. Styling lives in globals.css (.btn, .input, .card…)
// so every tab gets the same press feedback, focus ring and timing.

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", block, busy, className, children, type = "button", disabled, ...rest },
  ref
) {
  const cls = ["btn", `btn-${variant}`, size !== "md" && `btn-${size}`, block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || busy} data-busy={busy || undefined} {...rest}>
      <span className="btn-label">{children}</span>
    </button>
  );
});

export function Card({
  children,
  corner,
  className,
  style,
}: {
  children: React.ReactNode;
  corner?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className ? `card ${className}` : "card"} style={style}>
      {corner && <div className="card-corner">{corner}</div>}
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { className, mono, ...rest },
  ref
) {
  return <input ref={ref} className={["input", mono && "input-mono", className].filter(Boolean).join(" ")} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref
) {
  return <textarea ref={ref} className={className ? `input ${className}` : "input"} {...rest} />;
});

export function Skeleton({ width = "100%", height = 14, style }: { width?: number | string; height?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, ...style }} />;
}

// Placeholder shaped like a text card, shown while content loads.
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" role="status" aria-label="Loading">
      <div className="stack">
        <Skeleton width="55%" height={22} />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? "70%" : "100%"} />
        ))}
      </div>
    </div>
  );
}
