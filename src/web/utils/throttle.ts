/**
 * Throttle a function to limit how often it can be called
 * @param func The function to throttle
 * @param delay The minimum time between calls in milliseconds
 * @returns A throttled version of the function
 */
export function throttle<T extends unknown[]>(
  func: (...args: T) => void,
  delay: number
): (...args: T) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastExecTime = 0

  return (...args: T) => {
    const currentTime = Date.now()

    if (currentTime - lastExecTime < delay) {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(
        () => {
          lastExecTime = currentTime
          func(...args)
        },
        delay - (currentTime - lastExecTime)
      )
    } else {
      lastExecTime = currentTime
      func(...args)
    }
  }
}
