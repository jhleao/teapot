export type UiState = {
  stack: UiStack
}

export type UiStack = {
  commits: UiCommit[]
  isTrunk: boolean
}

export type UiCommit = {
  sha: string
  name: string
  timestampMs: number
  spinoffs: UiStack[]
  /**
   * Which branches is this commit a tip of
   */
  branches: UiBranch[]
}

export type UiBranch = {
  name: string
  isCurrent: boolean
}
