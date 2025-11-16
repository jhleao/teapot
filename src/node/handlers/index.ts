import { registerLocalStateHandlers } from './local-state'
import { registerRepoHandlers } from './repo'

export function registerHandlers(): void {
  registerRepoHandlers()
  registerLocalStateHandlers()
}
