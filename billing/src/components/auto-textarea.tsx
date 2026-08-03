"use client";

import { useEffect, useRef } from "react";

/**
 * A textarea that grows with its content and shrinks back when text is removed,
 * so a description can span several lines (press Enter for a new line) without
 * ever showing a scrollbar or wasting space when it's short.
 */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = "input text-sm",
  minRows = 2,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Re-fit whenever the value changes (typing, autofill, or reset).
  useEffect(resize, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      style={{ resize: "none", overflow: "hidden" }}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
    />
  );
}
