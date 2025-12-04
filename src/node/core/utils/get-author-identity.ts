import { exec } from 'child_process'
import { promisify } from 'util'
import { log } from '@shared/logger'
import { getGitAdapter } from '../git-adapter'

const execAsync = promisify(exec)

export interface AuthorIdentity {
  name: string
  email: string
}

export async function getAuthorIdentity(dir: string): Promise<AuthorIdentity> {
  try {
    const git = getGitAdapter()
    const name = await git.getConfig(dir, 'user.name')
    const email = await git.getConfig(dir, 'user.email')

    if (name && email) {
      return { name, email }
    }

    const systemName = name || (await getSystemGitConfig('user.name'))
    const systemEmail = email || (await getSystemGitConfig('user.email'))

    if (systemName && systemEmail) return { name: systemName, email: systemEmail }
  } catch (error) {
    log.warn('Failed to resolve git author identity:', error)
  }

  throw new Error('Failed to resolve git author identity')
}

async function getSystemGitConfig(key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`git config ${key}`)
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}
