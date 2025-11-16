import type { Configuration } from '@shared/types'
import dotenv from 'dotenv'

dotenv.config({ path: '../../.env' })

export function loadConfiguration(): Configuration {
  const repoPath = '/Users/leao/Documents/weve/weve'

  return { repoPath }
}
