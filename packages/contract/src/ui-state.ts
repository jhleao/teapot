export type Stack = {
  commits: Commit[]
}

type Commit = {
  tipOfBranches: string[]
  name: string
  timestampMs: number
  spinoffs: Stack[]
  /**
   * Which branches is this commit a tip of
   */
  branch?: Branch
}

type Branch = {
  name: string
  isCurrent: boolean
}
