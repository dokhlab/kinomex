export default function DiseasesTab({ diseases }: { diseases: { name: string; description: string; omim_id: string }[] }) {
  return (
    <div className="space-y-3">
      {diseases.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm rounded-2xl bg-slate-900/40 backdrop-blur-sm border border-rose-500/20">
          No disease associations reported for this kinase.
        </div>
      ) : (
        diseases.map((disease, idx) => (
          <div
            key={disease.name ?? idx}
            className="p-5 rounded-2xl bg-slate-900/40 backdrop-blur-sm border border-rose-500/20"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h4 className="text-base font-semibold text-white mb-2">
                  {disease.omim_id ? (
                    <a
                      href={`https://omim.org/entry/${disease.omim_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-kinome-cyan transition-colors"
                    >
                      {disease.name}
                      <svg className="w-3 h-3 inline ml-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ) : (
                    disease.name
                  )}
                </h4>
                {disease.description && (
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {disease.description}
                  </p>
                )}
              </div>
              {disease.omim_id && (
                <a
                  href={`https://omim.org/entry/${disease.omim_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 transition-colors flex-shrink-0"
                >
                  OMIM:{disease.omim_id}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
