import type { Configuration } from '@shared/types'
import fs from 'fs'
import git from 'isomorphic-git'
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
    const resolvedRef = await git.resolveRef({
      fs,
      dir,
      ref,
      depth: 2
    })
    const headMatch = resolvedRef.match(/refs\/heads\/(.+)/)
    if (headMatch && headMatch[1]) {
      return headMatch[1]
    }
    const remoteMatch = resolvedRef.match(/refs\/remotes\/[^/]+\/(.+)/)
    return remoteMatch && remoteMatch[1] ? remoteMatch[1] : null
  } catch {
    return null
  }
}
