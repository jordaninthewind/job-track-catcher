import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shows a temporary label after an action, then reverts. */
function useFlash(ms = 1500) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), ms);
  };
  return [text, flash] as const;
}

export function CopyButton({
  getText,
  children,
  disabled,
}: {
  getText: () => string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [flashText, flash] = useFlash();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      flash("Copied ✓");
    } catch {
      flash("Copy failed");
    }
  };
  return (
    <button type="button" onClick={copy} disabled={disabled}>
      {flashText ?? children}
    </button>
  );
}

/** First click arms the button; a second click within 3s runs the action. */
export function ConfirmButton({
  onConfirm,
  children,
  className,
  disabled,
}: {
  onConfirm: () => unknown;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? "confirm" : className}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? "Click again to confirm" : children}
    </button>
  );
}
