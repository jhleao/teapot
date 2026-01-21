import { describe, expect, it } from 'vitest'
import { getPrStateStyles } from '../pr-state-styles'

describe('getPrStateStyles', () => {
  it('returns green styling for open PRs', () => {
    const result = getPrStateStyles('open')
    expect(result.textClass).toBe('text-green-500')
    expect(result.label).toBe('')
  })

  it('returns muted styling with draft label for draft PRs', () => {
    const result = getPrStateStyles('draft')
    expect(result.textClass).toBe('text-muted-foreground')
    expect(result.label).toBe(' (Draft)')
  })

  it('returns red styling with closed label for closed PRs', () => {
    const result = getPrStateStyles('closed')
    expect(result.textClass).toBe('text-red-500')
    expect(result.label).toBe(' (Closed)')
  })

  it('returns purple styling with merged label for merged PRs', () => {
    const result = getPrStateStyles('merged')
    expect(result.textClass).toBe('text-purple-500')
    expect(result.label).toBe(' (Merged)')
  })

  it('returns muted styling with no label for unknown states', () => {
    const result = getPrStateStyles('unknown')
    expect(result.textClass).toBe('text-muted-foreground')
    expect(result.label).toBe('')
  })

  it('handles empty string state', () => {
    const result = getPrStateStyles('')
    expect(result.textClass).toBe('text-muted-foreground')
    expect(result.label).toBe('')
  })

  it('is case-sensitive (uppercase states fall through to default)', () => {
    const result = getPrStateStyles('OPEN')
    expect(result.textClass).toBe('text-muted-foreground')
    expect(result.label).toBe('')
  })
})
