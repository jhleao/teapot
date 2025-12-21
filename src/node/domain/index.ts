/**
 * Domain Layer - Pure business logic with no I/O dependencies.
 *
 * All classes in this module are pure - they contain only synchronous functions
 * that operate on data without side effects. For async operations that require
 * git or other I/O, use the services layer.
 */

export { BranchUtils } from './BranchUtils'
export { PrTargetResolver } from './PrTargetResolver'
export { RebaseIntentBuilder } from './RebaseIntentBuilder'
export { RebaseStateMachine } from './RebaseStateMachine'
export { RebaseValidator } from './RebaseValidator'
export { ShipItNavigator } from './ShipItNavigator'
export { StackAnalyzer } from './StackAnalyzer'
export { TrunkResolver } from './TrunkResolver'
export { UiStateBuilder } from './UiStateBuilder'
export type { FullUiState, FullUiStateOptions } from './UiStateBuilder'
