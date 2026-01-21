/**
 * PR state-based styling utilities.
 * Provides consistent visual styling for PR state across the UI.
 */

export interface PrStateStyles {
  /** Tailwind CSS class for text color */
  textClass: string
  /** Label suffix to append to PR number (e.g., ' (Closed)') */
  label: string
}

/**
 * Returns styling information for a PR based on its state.
 *
 * @param state - The PR state ('open', 'draft', 'closed', 'merged')
 * @returns Styling information including text class and label suffix
 */
export function getPrStateStyles(state: string): PrStateStyles {
  switch (state) {
    case 'open':
      return { textClass: 'text-green-500', label: '' }
    case 'draft':
      return { textClass: 'text-muted-foreground', label: ' (Draft)' }
    case 'closed':
      return { textClass: 'text-red-500', label: ' (Closed)' }
    case 'merged':
      return { textClass: 'text-purple-500', label: ' (Merged)' }
    default:
      return { textClass: 'text-muted-foreground', label: '' }
  }
}
