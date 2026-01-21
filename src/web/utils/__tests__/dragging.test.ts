import { describe, expect, it } from 'vitest'
import { findClosestCommitBelowMouse, type CommitBoundingBox } from '../dragging'

describe('findClosestCommitBelowMouse', () => {
  const createBoxes = (...centerYs: number[]): CommitBoundingBox[] =>
    centerYs.map((centerY, i) => ({ sha: `sha${i}`, centerY }))

  describe('without scroll compensation', () => {
    it('returns null when no commits are below mouse', () => {
      const boxes = createBoxes(100, 200, 300)
      const result = findClosestCommitBelowMouse(400, boxes, 0, 0)
      expect(result).toBeNull()
    })

    it('returns closest commit below mouse', () => {
      const boxes = createBoxes(100, 200, 300, 400)
      const result = findClosestCommitBelowMouse(150, boxes, 0, 0)
      expect(result).toBe('sha1') // centerY 200 is closest below 150
    })

    it('returns null for empty boxes', () => {
      const result = findClosestCommitBelowMouse(100, [], 0, 0)
      expect(result).toBeNull()
    })

    it('ignores commits above or at mouse position', () => {
      const boxes = createBoxes(100, 150, 200)
      const result = findClosestCommitBelowMouse(150, boxes, 0, 0)
      expect(result).toBe('sha2') // Only 200 is strictly below 150
    })
  })

  describe('with scroll compensation', () => {
    it('adjusts for scroll down (positive delta)', () => {
      // User started drag at scrollTop=0, now scrolled to scrollTop=100
      // Commit was at viewport Y=300 when captured
      // After scrolling down 100px, commit visually moved to Y=200
      // Mouse at Y=250 should find the commit (adjusted: 250+100=350, 300 < 350 so not below)
      const boxes = createBoxes(300, 400)

      // Mouse at 250, scroll delta +100 -> adjusted mouse at 350
      // 300 is NOT > 350, 400 IS > 350
      const result = findClosestCommitBelowMouse(250, boxes, 0, 100)
      expect(result).toBe('sha1') // centerY 400, adjusted distance = 50
    })

    it('adjusts for scroll up (negative delta)', () => {
      // User started drag at scrollTop=100, now scrolled to scrollTop=0
      // Commit was at viewport Y=200 when captured
      // After scrolling up 100px, commit visually moved to Y=300
      const boxes = createBoxes(200, 300)

      // Mouse at 250, scroll delta -100 -> adjusted mouse at 150
      // 200 IS > 150 (distance 50), 300 IS > 150 (distance 150)
      const result = findClosestCommitBelowMouse(250, boxes, 100, 0)
      expect(result).toBe('sha0') // centerY 200, closest below adjusted mouse 150
    })

    it('handles no scroll change', () => {
      const boxes = createBoxes(100, 200, 300)
      const result = findClosestCommitBelowMouse(150, boxes, 50, 50)
      expect(result).toBe('sha1') // Same as no scroll
    })

    it('correctly identifies target after large scroll', () => {
      // Simulate scrolling down 500px
      const boxes = createBoxes(100, 200, 300, 400, 500, 600)

      // Mouse at Y=100, scroll delta +500 -> adjusted mouse at 600
      // Only 600 could be below, but 600 is NOT > 600
      const result = findClosestCommitBelowMouse(100, boxes, 0, 500)
      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles mouse exactly at commit position', () => {
      const boxes = createBoxes(100, 200, 300)
      // Mouse at exactly 200 - commit at 200 is NOT below (not strictly greater)
      const result = findClosestCommitBelowMouse(200, boxes, 0, 0)
      expect(result).toBe('sha2') // 300 is the only one strictly below
    })

    it('handles single commit', () => {
      const boxes = createBoxes(200)
      expect(findClosestCommitBelowMouse(100, boxes, 0, 0)).toBe('sha0')
      expect(findClosestCommitBelowMouse(200, boxes, 0, 0)).toBeNull()
      expect(findClosestCommitBelowMouse(300, boxes, 0, 0)).toBeNull()
    })
  })
})
