import type { Configuration } from '@shared/types'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function getTrunkBranchRef(
  config: Configuration,
  branches: string[]
): Promise<string | null> {
  const dir = config.repoPath

  const remoteHeadBranch = await resolveBranchFromRef(dir, 'refs/remotes/origin/HEAD')
  if (remoteHeadBranch) {
    return remoteHeadBranch
  }

  // Fallback: Common trunk branch names in order of preference
  const trunkCandidates = ['main', 'master', 'develop']
  return trunkCandidates.find((name) => branches.includes(name)) || branches[0] || null
}

async function resolveBranchFromRef(dir: string, ref: string): Promise<string | null> {
  try {
    // Try to extract branch name from symbolic ref
    // For symbolic refs, we use raw git command (async to not block event loop)
    const { stdout } = await execAsync(`git symbolic-ref ${ref}`, {
      cwd: dir,
      encoding: 'utf-8'
    })
    const symbolicRef = stdout.trim()

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
}
