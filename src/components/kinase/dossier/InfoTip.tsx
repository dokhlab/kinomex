"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const showTooltip = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top - 8, left: r.left + r.width / 2 });
    }
    setShow(true);
  };

  const hideTooltip = () => setShow(false);

  return (
    <span className="inline-flex items-center">
      <span
        ref={ref}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-slate-500/50 text-[9px] text-slate-500 cursor-help hover:border-kinome-cyan/50 hover:text-kinome-cyan transition-colors"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        tabIndex={0}
        role="button"
        aria-label="More information"
      >
        ?
      </span>
      {show && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 px-3 py-1.5 text-xs leading-tight text-white bg-slate-800/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-lg pointer-events-none w-56 text-center"
          style={{ top: pos.top, left: pos.left, transform: "translateX(-50%) translateY(-100%)" }}
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800/95" />
        </div>,
        document.body
      )}
    </span>
  );
}
