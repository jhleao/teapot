/**
 * Domain Layer - Pure business logic with no I/O dependencies.
 *
 * All classes in this module are pure - they contain only synchronous functions
 * that operate on data without side effects. For async operations that require
 * git or other I/O, use the services layer.
 */

export { BranchUtils } from './BranchUtils'
export { extractRepoName, isValidGitUrl, parseGitCloneError } from './GitUrlParser'
export { PrTargetResolver } from './PrTargetResolver'
export { RebaseIntentBuilder } from './RebaseIntentBuilder'
export {
  InvalidTransitionError,
  canTransition,
  createIdlePhase,
  getPhaseDescription,
  transition
} from './RebasePhase'
export type {
  CompletedPhase,
  ConflictedPhase,
  ErrorPhase,
  ExecutingPhase,
  FinalizingPhase,
  IdlePhase,
  PlanningPhase,
  QueuedPhase,
  RebaseEvent,
  RebasePhase
} from './RebasePhase'
export { RebaseStateMachine } from './RebaseStateMachine'
export { RebaseValidator } from './RebaseValidator'
export { ShipItNavigator } from './ShipItNavigator'
export { SquashValidator } from './SquashValidator'
export { StackAnalyzer } from './StackAnalyzer'
export { TrunkResolver } from './TrunkResolver'
export { UiStateBuilder } from './UiStateBuilder'
export type { FullUiState, FullUiStateOptions } from './UiStateBuilder'
