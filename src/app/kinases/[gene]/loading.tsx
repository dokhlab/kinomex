export default function KinaseDetailLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" aria-label="Loading kinase profile">
      <div className="space-y-3 mb-8">
        <div className="h-4 w-48 rounded bg-white/5 animate-shimmer" />
        <div className="h-10 w-40 rounded bg-white/5 animate-shimmer" />
        <div className="h-5 w-96 max-w-full rounded bg-white/5 animate-shimmer" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="h-24 rounded-2xl bg-white/5 animate-shimmer" />
        <div className="h-24 rounded-2xl bg-white/5 animate-shimmer" />
        <div className="h-24 rounded-2xl bg-white/5 animate-shimmer" />
      </div>
      <div className="h-12 rounded-xl bg-white/5 animate-shimmer mb-6" />
      <div className="h-64 rounded-2xl bg-white/5 animate-shimmer" />
    </div>
  );
}
