/**
 * Creates a job ID generator function.
 *
 * Returns a function that generates unique job IDs with the format:
 * `job-{timestamp}-{counter}`
 */
export function createJobIdGenerator(): () => string {
  let counter = 0
  return () => {
    counter++
    return `job-${Date.now()}-${counter}`
  }
}
