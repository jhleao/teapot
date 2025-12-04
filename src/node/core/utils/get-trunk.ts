import type { Configuration } from '@shared/types'
import { log } from '@shared/logger'

export async function getTrunkBranchRef(
  config: Configuration,
  branches: string[]
): Promise<string | null> {
  const dir = config.repoPath

  const remoteHeadBranch = await resolveBranchFromRef(dir, 'refs/remotes/origin/HEAD')
  if (remoteHeadBranch) {
    log.debug(`Inferred trunk branch from origin/HEAD: ${remoteHeadBranch}`)
    return remoteHeadBranch
  }

  log.debug('Could not infer trunk from origin/HEAD, using fallback sources')

  // Fallback: Common trunk branch names in order of preference
  const trunkCandidates = ['main', 'master', 'develop']
  return trunkCandidates.find((name) => branches.includes(name)) || branches[0] || null
}

async function resolveBranchFromRef(dir: string, ref: string): Promise<string | null> {
  try {
    // Try to extract branch name from symbolic ref
    // For symbolic refs, we use raw git command
    const { execSync } = await import('child_process')
    try {
      const symbolicRef = execSync(`git symbolic-ref ${ref}`, {
        cwd: dir,
        encoding: 'utf-8'
      }).trim()

      const headMatch = symbolicRef.match(/refs\/heads\/(.+)/)
      if (headMatch && headMatch[1]) {
        return headMatch[1]
      }
      const remoteMatch = symbolicRef.match(/refs\/remotes\/[^/]+\/(.+)/)
      return remoteMatch && remoteMatch[1] ? remoteMatch[1] : null
    } catch {
      // If symbolic-ref fails, ref is not symbolic
      return null
    }
  } catch {
    return null
  }
}
