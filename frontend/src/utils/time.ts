export function fmtMinutes(minutes: number | null | undefined) {
  if (minutes == null) return '未估算'
  const totalSeconds = Math.max(0, Math.floor(minutes * 60 + 1e-6))
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  return [hours ? `${hours}h` : '', mins ? `${mins}m` : '', seconds || !totalSeconds ? `${seconds}s` : '']
    .filter(Boolean).join(' ')
}
