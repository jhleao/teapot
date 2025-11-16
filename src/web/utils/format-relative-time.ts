/**
 * Formats a timestamp as a relative time string (e.g., "3h", "1m", "4 days")
 * @param timestampMs - Timestamp in milliseconds
 * @returns Formatted relative time string
 */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now()
  const diffMs = now - timestampMs
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSeconds < 60) {
    return `${diffSeconds}s`
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }

  if (diffHours < 24) {
    return `${diffHours}h`
  }

  if (diffDays < 7) {
    return `${diffDays}d`
  }

  if (diffWeeks < 4) {
    return `${diffWeeks}w`
  }

  if (diffMonths < 12) {
    return `${diffMonths}mo`
  }

  return `${diffYears}y`
}
