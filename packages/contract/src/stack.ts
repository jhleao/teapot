export type Stack = {
  commits: Commit[]
}

type Commit = {
  name: string
  timestampMs: number
  spinoffs: Stack[]
  /**
   * Which branches is this commit a tip of
   */
  branches: Branch[]
}

type Branch = {
  name: string
  isCurrent: boolean
}
