export function ComingSoonTab({ label }: { label: string }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center">
      <p className="font-medium text-ink">{label}</p>
      <p className="mt-1 text-sm text-ink/60">Coming soon.</p>
    </div>
  )
}
