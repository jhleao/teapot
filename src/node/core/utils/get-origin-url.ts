import { log } from '@shared/logger'
import fs from 'fs'
import git from 'isomorphic-git'

export async function getOriginUrl(repoPath: string): Promise<string | undefined> {
  log.debug(`[getOriginUrl] Listing remotes for ${repoPath}...`)
  try {
    const remotes = await git.listRemotes({ fs, dir: repoPath })
    log.debug(
      `[getOriginUrl] Found ${remotes.length} remotes:`,
      remotes.map((r) => `${r.remote}=${r.url}`)
    )
    const origin = remotes.find((r) => r.remote === 'origin')

    let remoteUrl = origin?.url
    if (remoteUrl && remoteUrl.startsWith('git@')) {
      // Convert SSH URL to HTTPS for isomorphic-git compatibility with PAT
      // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
      log.debug(`[getOriginUrl] Converting SSH URL to HTTPS: ${remoteUrl}`)
      remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/')
      log.debug(`[getOriginUrl] Converted URL: ${remoteUrl}`)
    } else if (remoteUrl) {
      log.debug(`[getOriginUrl] Using remote URL: ${remoteUrl}`)
    } else {
      log.warn(`[getOriginUrl] No origin remote found`)
    }

    return remoteUrl
  } catch (error) {
    log.error(`[getOriginUrl] Failed to list remotes:`, error)
    return undefined
  }
}
