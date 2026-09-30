"use client";

export function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
        active
          ? "bg-kinome-cyan/15 text-kinome-cyan border border-kinome-cyan/30"
          : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

export function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-kinome-cyan">
          {icon}
        </div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass rounded-2xl p-6 border border-white/10 ${className}`}>
      {title && <h3 className="text-base font-semibold text-white mb-3">{title}</h3>}
      {children}
    </div>
  );
}

export function MathBlock({ children }: { children: string }) {
  return (
    <div className="bg-slate-900/80 border border-white/10 rounded-xl px-5 py-3 text-sm font-mono text-kinome-cyan overflow-x-auto my-3">
      {children}
    </div>
  );
}
