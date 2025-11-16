import { ipcMain } from 'electron'
import type { UiStack } from '@shared/types'
import { generateMockStack } from '../utils/generate-mock-stack'
import { RebaseIntent, Repo, RebaseJobId, Configuration } from '@shared/types'
import { buildFullUiState } from '../core/utils/build-ui-state.js'
import { buildRepoModel, loadConfiguration } from '../core'

const getRepo: IpcHandlerOf<'getRepo'> = () => {
  const now = Date.now()
  const baseTime = now - 172800000 // 2 days ago
  const timeStep = 7200000 // 2 hours between commits

  const stack = generateMockStack(baseTime, timeStep)
  const workingTree = generateMockWorkingTreeFiles()

  return {
    stack,
    workingTree
  }
}

export function registerRepoHandlers(): void {
  ipcMain.handle('getRepo', getRepo)
}

export type SubmitRebaseIntentOptions = {
  /**
   * Optional repository model, when the caller already has the latest Repo snapshot.
   * When omitted the function will load configuration and rebuild the Repo.
   */
  repo?: Repo
  /** Override configuration to locate the repo when a model is not provided. */
  config?: Configuration
  /** Deterministic job id generator for tests/previews. */
  generateJobId?: () => RebaseJobId
}

/**
 * Entry point for the UI: accepts a rebase intent, refreshes the repo model if needed,
 * and returns the derived UI projection (current + planned stacks plus queue metadata).
 */
export async function submitRebaseIntent(
  intent: RebaseIntent,
  options: SubmitRebaseIntentOptions = {}
): Promise<UiStack | null> {
  const { repo, config = loadConfiguration(), generateJobId } = options
  const repoModel = repo ?? (await buildRepoModel(config))

  const newState = buildFullUiState(repoModel, {
    rebaseIntent: intent,
    generateJobId
  })
  return newState.projectedStack
}
