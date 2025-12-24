/**
 * BranchUtils - Pure domain logic for branch operations.
 *
 * This class consolidates all branch-related pure functions.
 * Async operations (that require git adapter) are in GitService.
 */

import type { RemoteBranchRef } from '@shared/types/repo'
import { REMOTE_PREFIXES } from '../shared/constants'

export class BranchUtils {
  // Prevent instantiation - use static methods
  private constructor() {}

  /**
   * Parses a remote branch ref into remote name and local branch name.
   * Handles both 'origin/main' and 'refs/remotes/origin/main' formats,
   * as well as branches with slashes like 'origin/feature/foo/bar'.
   *
   * @example
   * parseRemoteBranch('origin/main')
   * // => { remote: 'origin', localBranch: 'main' }
   *
   * @example
   * parseRemoteBranch('origin/feature/foo')
   * // => { remote: 'origin', localBranch: 'feature/foo' }
   *
   * @example
   * parseRemoteBranch('main')
   * // => null (local branch, no remote prefix)
   */
  public static parseRemoteBranch(ref: string): RemoteBranchRef | null {
    if (!ref) return null

    // Handle 'refs/remotes/origin/main' format
    const normalized = ref.replace(/^refs\/remotes\//, '')

    // Match remote/branch where remote is the first segment and branch is everything after
    const match = normalized.match(/^([^/]+)\/(.+)$/)
    if (!match) return null

    return {
      remote: match[1],
      localBranch: match[2]
    }
  }

  /**
   * Normalizes a branch reference by stripping remote prefix if present.
   * For local branches, returns as-is.
   *
   * @example
   * normalizeBranchRef('origin/main', true) // => 'main'
   * normalizeBranchRef('main', false) // => 'main'
   */
  public static normalizeBranchRef(ref: string, isRemote: boolean): string {
    if (!isRemote) return ref
    const slashIndex = ref.indexOf('/')
    return slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref
  }

  /**
   * Checks if a branch ref looks like a remote branch (e.g., 'origin/main').
   * Used to filter out remote-looking refs from local branch lists.
   */
  public static isRemoteBranchRef(ref: string): boolean {
    const slashIndex = ref.indexOf('/')
    if (slashIndex <= 0) return false
    const prefix = ref.slice(0, slashIndex)
    return REMOTE_PREFIXES.includes(prefix as (typeof REMOTE_PREFIXES)[number])
  }

  /**
   * Checks if a branch ref is a symbolic branch (HEAD or ends with /HEAD).
   */
  public static isSymbolicBranch(ref: string): boolean {
    return ref === 'HEAD' || ref.endsWith('/HEAD')
  }

  /**
   * Extracts the local branch name from a branch descriptor.
   * For local branches, returns the ref as-is.
   * For remote branches, strips the remote prefix.
   */
  public static getBranchName(ref: string, isRemote: boolean): string {
    if (!isRemote) return ref
    const slashIndex = ref.indexOf('/')
    return slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref
  }

  /**
   * Generates a random branch name with a given prefix.
   * Format: prefix-adjective-noun (e.g., 'feature-quick-fox')
   */
  public static generateRandomBranchName(prefix: string = 'branch'): string {
    const adjectives = [
      'aromatic',
      'bold',
      'calming',
      'cooling',
      'delicate',
      'earthy',
      'fragrant',
      'gentle',
      'invigorating',
      'refreshing',
      'smooth',
      'soothing',
      'spiced',
      'steaming',
      'strong',
      'sweet'
    ]
    const nouns = [
      'assam',
      'bancha',
      'butterflypea',
      'ceylon',
      'chai',
      'chamomile',
      'darjeeling',
      'earlgrey',
      'gabaoolong',
      'genmaicha',
      'gyokuro',
      'herbal',
      'hibiscus',
      'houjicha',
      'jasmine',
      'keemun',
      'kukicha',
      'lapsang',
      'lavender',
      'lemongrass',
      'liubao',
      'longjing',
      'masalachai',
      'matcha',
      'milkoolong',
      'nilgiri',
      'oolong',
      'peppermint',
      'rooibos',
      'sencha',
      'shengpu',
      'shoupu',
      'yunnan'
    ]

    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
    const randomNumber = Math.floor(Math.random() * 1000)

    return `${prefix}-${randomAdjective}-${randomNoun}-${randomNumber}`
  }

  /**
   * Generates a branch name from a username with a random suffix.
   * Format: sanitized-username-randomcode (e.g., 'john-a8f3c2d1')
   */
  public static generateUserBranchName(username: string): string {
    const randomCode = Math.random().toString(36).substring(2, 10)
    const sanitizedUsername = username
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase()
    return `${sanitizedUsername}-${randomCode}`
  }

  /**
   * Validates that a branch name is valid for git.
   * Returns null if valid, or an error message if invalid.
   */
  public static validateBranchName(name: string): string | null {
    if (!name || name.trim().length === 0) {
      return 'Branch name cannot be empty'
    }

    // Git branch name rules
    if (name.startsWith('-')) {
      return 'Branch name cannot start with a hyphen'
    }
    if (name.endsWith('.')) {
      return 'Branch name cannot end with a dot'
    }
    if (name.endsWith('.lock')) {
      return 'Branch name cannot end with .lock'
    }
    if (name.includes('..')) {
      return 'Branch name cannot contain ..'
    }
    if (name.includes('@{')) {
      return 'Branch name cannot contain @{'
    }
    if (BranchUtils.containsInvalidGitBranchChars(name)) {
      return 'Branch name contains invalid characters'
    }
    if (name.includes(' ')) {
      return 'Branch name cannot contain spaces'
    }

    return null
  }

  private static containsInvalidGitBranchChars(name: string): boolean {
    // Avoid regex control ranges (eslint `no-control-regex`) while keeping behavior equivalent.
    // Matches the intent of: /[\x00-\x1f\x7f~^:?*\[\\]/
    const forbidden = new Set(['~', '^', ':', '?', '*', '[', '\\'])

    for (let i = 0; i < name.length; i++) {
      const code = name.charCodeAt(i)
      if (code <= 0x1f || code === 0x7f) return true
      if (forbidden.has(name[i])) return true
    }

    return false
  }
}
