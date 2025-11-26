import {
  IPC_CHANNELS,
  IpcHandlerOf,
  UiState,
  UiWorkingTreeFile,
  type Configuration
} from '@shared/types'
import { ipcMain, IpcMainEvent } from 'electron'
import {
  amend as amendCommit,
  buildRepoModel,
  buildUiStack,
  checkout,
  commitToNewBranch,
  deleteBranch,
  discardChanges,
  updateFileStageStatus
} from '../core'
import { gitForgeService } from '../core/forge/service'
import { GitWatcher } from '../core/git-watcher'
import { buildRebaseIntent } from '../core/utils/build-rebase-intent'
import { buildFullUiState } from '../core/utils/build-ui-state'
import { buildUiWorkingTree } from '../core/utils/build-ui-working-tree'

const watchRepo: IpcHandlerOf<'watchRepo'> = (event, { repoPath }) => {
  GitWatcher.getInstance().watch(repoPath, event.sender)
}

const unwatchRepo: IpcHandlerOf<'unwatchRepo'> = () => {
  GitWatcher.getInstance().stop()
}

const getRepo: IpcHandlerOf<'getRepo'> = async (_event, { repoPath }) => {
  const config: Configuration = { repoPath }
  const [repo, forgeState] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath)
  ])
  const stack = buildUiStack(repo, forgeState)
  const workingTree = buildUiWorkingTree(repo)

  if (!stack) return null

  const uiState: UiState = {
    stack,
    workingTree
  }

  return uiState
}

const submitRebaseIntent: IpcHandlerOf<'submitRebaseIntent'> = async (
  _event,
  { repoPath, headSha, baseSha }
) => {
  const workingTree = [] as UiWorkingTreeFile[]

  const config: Configuration = { repoPath }
  const [repo, forgeState] = await Promise.all([
    buildRepoModel(config),
    gitForgeService.getState(repoPath)
  ])

  const rebaseIntent = buildRebaseIntent(repo, headSha, baseSha)
  if (!rebaseIntent) {
    return null
  }

  const fullUiState = buildFullUiState(repo, { rebaseIntent, gitForgeState: forgeState })
  const stack = fullUiState.projectedStack ?? fullUiState.stack
  if (!stack) {
    return null
  }

  const uiState: UiState = {
    stack,
    workingTree
  }

  return uiState
}

const confirmRebaseIntent: IpcHandlerOf<'confirmRebaseIntent'> = (_event, { repoPath }) => {
  // TODO: Implement actual rebase confirmation logic
  return getRepo({} as IpcMainEvent, { repoPath })
}

const cancelRebaseIntent: IpcHandlerOf<'cancelRebaseIntent'> = (_event, { repoPath }) => {
  // TODO: Implement rebase cancellation logic
  return getRepo({} as IpcMainEvent, { repoPath })
}

const discardStaged: IpcHandlerOf<'discardStaged'> = async (_event, { repoPath }) => {
  await discardChanges(repoPath)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const amend: IpcHandlerOf<'amend'> = async (_event, { repoPath, message }) => {
  await amendCommit(repoPath, message)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const commit: IpcHandlerOf<'commit'> = async (_event, { repoPath, message, newBranchName }) => {
  await commitToNewBranch(repoPath, message, newBranchName)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const setFilesStageStatus: IpcHandlerOf<'setFilesStageStatus'> = async (
  _event,
  { repoPath, staged, files }
) => {
  await updateFileStageStatus(repoPath, files, staged)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const checkoutHandler: IpcHandlerOf<'checkout'> = async (_event, { repoPath, ref }) => {
  await checkout(repoPath, ref)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const deleteBranchHandler: IpcHandlerOf<'deleteBranch'> = async (
  _event,
  { repoPath, branchName }
) => {
  await deleteBranch(repoPath, branchName)
  return getRepo({} as IpcMainEvent, { repoPath })
}

const createPullRequest: IpcHandlerOf<'createPullRequest'> = async (
  _event,
  { repoPath, headBranch }
) => {
  const config: Configuration = { repoPath }
  // We need the repo model to find the base branch and commit message
  const repo = await buildRepoModel(config)
  
  const headBranchObj = repo.branches.find(b => b.ref === headBranch)
  if (!headBranchObj) {
    throw new Error(`Branch ${headBranch} not found`)
  }

  const headCommit = repo.commits.find(c => c.sha === headBranchObj.headSha)
  if (!headCommit) {
    throw new Error(`Commit ${headBranchObj.headSha} not found`)
  }
  
  const title = headCommit.message.split('\n')[0] || 'No title'
  
  // Find base branch by traversing up the parents
  let baseBranch = ''
  let currentSha = headCommit.parentSha
  
  // Safety limit for traversal
  let depth = 0
  const MAX_DEPTH = 1000

  while (currentSha && depth < MAX_DEPTH) {
    depth++
    
    // Check if any local branch points to this SHA
    const branchesOnCommit = repo.branches.filter(
      b => b.headSha === currentSha && !b.isRemote
    )
    
    if (branchesOnCommit.length > 0) {
      // Prioritize trunk if present
      const trunk = branchesOnCommit.find(b => b.isTrunk)
      if (trunk) {
        baseBranch = trunk.ref
        break
      }
      // Otherwise pick the first one
      baseBranch = branchesOnCommit[0].ref
      break
    }

    const currentCommit = repo.commits.find(c => c.sha === currentSha)
    if (!currentCommit) break
    currentSha = currentCommit.parentSha
  }
  
  if (!baseBranch) {
    // Fallback to trunk if we can't find anything
    const trunk = repo.branches.find(b => b.isTrunk && !b.isRemote)
    if (trunk) {
      baseBranch = trunk.ref
    } else {
      // If no local trunk, try remote trunk? 
      // Usually git-forge expects a branch name that exists on the remote.
      // If we have 'main' local, we use 'main'.
      // If we don't, maybe we should error.
      throw new Error('Could not determine base branch for PR')
    }
  }

  await gitForgeService.createPullRequest(repoPath, title, headBranch, baseBranch, false)
  return getRepo({} as IpcMainEvent, { repoPath })
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRepo, getRepo)
  ipcMain.handle(IPC_CHANNELS.submitRebaseIntent, submitRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.confirmRebaseIntent, confirmRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.cancelRebaseIntent, cancelRebaseIntent)
  ipcMain.handle(IPC_CHANNELS.discardStaged, discardStaged)
  ipcMain.handle(IPC_CHANNELS.amend, amend)
  ipcMain.handle(IPC_CHANNELS.commit, commit)
  ipcMain.handle(IPC_CHANNELS.setFilesStageStatus, setFilesStageStatus)
  ipcMain.handle(IPC_CHANNELS.checkout, checkoutHandler)
  ipcMain.handle(IPC_CHANNELS.deleteBranch, deleteBranchHandler)
  ipcMain.handle(IPC_CHANNELS.watchRepo, watchRepo)
  ipcMain.handle(IPC_CHANNELS.unwatchRepo, unwatchRepo)
  ipcMain.handle(IPC_CHANNELS.createPullRequest, createPullRequest)
}
