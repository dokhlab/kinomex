interface KinaseAssistantIconProps {
  className?: string;
}

/** Original KinomeX alpaca mark with a small phosphotransfer-node accent. */
export default function KinaseAssistantIcon({ className = "h-6 w-6" }: KinaseAssistantIconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* Tall ears and woolly crown remain legible at navigation-icon scale. */}
      <path d="M10.4 9.25 8.55 3.8c-.28-.82.62-1.5 1.32-.99l3.55 2.58M21.55 9.25l1.9-5.45c.28-.82-.62-1.5-1.32-.99l-3.58 2.58" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.3 10.4c.2-3.72 3.16-6.15 6.7-6.15s6.5 2.43 6.7 6.15l.54 8.08c.25 3.78-2.75 6.97-6.54 6.97h-1.4c-3.79 0-6.79-3.19-6.54-6.97l.54-8.08Z" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.55" />
      {/* Asymmetric curls give the emblem a hand-drawn, friendly character. */}
      <path d="M9.75 9.1c.45-1.25 1.5-2.05 2.72-2.05.42-1.2 1.58-2.05 2.93-2.05 1.12 0 2.1.58 2.65 1.48 1.57-.05 2.88.93 3.22 2.33" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      <path d="M12.15 13.5h.02M19.83 13.5h.02" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      <path d="M13.25 18.15c.28-1.37 1.34-2.28 2.75-2.28s2.47.91 2.75 2.28c.27 1.34-.77 2.58-2.14 2.58h-1.22c-1.37 0-2.41-1.24-2.14-2.58Z" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.25" />
      <path d="M14.85 18.1h.02M17.13 18.1h.02M16 20.75v1.35" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      {/* Phosphate node: a compact scientific signature, not a sparkle. */}
      <path d="m21.75 21.6 2.18 1.45" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="26.05" cy="24.45" r="2.65" fill="currentColor" />
      <path d="M24.95 24.45h2.2M26.05 23.35v2.2" stroke="rgb(2 6 23)" strokeWidth=".95" strokeLinecap="round" />
    </svg>
  );
}
