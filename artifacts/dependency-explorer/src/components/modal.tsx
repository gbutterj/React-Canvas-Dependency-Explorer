import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-[hsl(205_40%_10%/.55)] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel-in outline-none w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[90dvh] flex flex-col rounded-xl border border-border bg-card shadow-2xl`}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button aria-label="Close dialog" data-testid="button-close-dialog" onClick={onClose} className="p-1.5 rounded-md hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto scroll-thin p-5">{children}</div>
      </div>
    </div>
  );
}
