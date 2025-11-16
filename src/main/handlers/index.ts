import { registerRepoHandlers } from './repo'
import { registerTestHandlers } from './test'

export function registerHandlers(): void {
  registerTestHandlers()
  registerRepoHandlers()
}
