export function compactNumber(value: number | null | undefined): string {
  const number = Number(value ?? 0)
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number)
}

export function fullNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en').format(Number(value ?? 0))
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'bg-steel'
  if (score >= 65) return 'bg-moss'
  if (score >= 50) return 'bg-gold'
  if (score >= 40) return 'bg-coral'
  return 'bg-ink'
}

export function statusColor(status: string): string {
  if (['complete', 'full'].includes(status)) return 'bg-moss text-white'
  if (['partial', 'ready', 'running', 'retrying'].includes(status)) return 'bg-gold text-ink'
  if (['skipped'].includes(status)) return 'bg-fog text-steel border border-ink/10'
  if (['failed'].includes(status)) return 'bg-coral text-white'
  return 'bg-white text-ink border border-ink/10'
}
