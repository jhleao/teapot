export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LOG_LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace']

const isBrowser = typeof window !== 'undefined'

const styles: Record<LogLevel, { label: string; color: string; ansi: string }> = {
  info: { label: 'INFO', color: '#2ecc71', ansi: '\x1b[32m' },
  warn: { label: 'WARN', color: '#f1c40f', ansi: '\x1b[33m' },
  error: { label: 'ERROR', color: '#e74c3c', ansi: '\x1b[31m' },
  debug: { label: 'DEBUG', color: '#3498db', ansi: '\x1b[34m' },
  trace: { label: 'TRACE', color: '#9b59b6', ansi: '\x1b[35m' }
}

// --- File logging for Node.js only ---
let fileLoggingInitialized = false
let isEnabledFn: (() => boolean) | null = null
let getRepoPathFn: (() => string | null) | null = null
const clearedThisSession = new Set<string>()

// Dynamic imports for Node.js only (not available in browser)
let fs: typeof import('fs') | null = null
let path: typeof import('path') | null = null

/**
 * Initialize file logging (call from main process on startup).
 * @param isEnabled - function to check if debug logging is enabled
 * @param getRepoPath - function to get current repo path
 */
export async function initFileLogging(
  isEnabled: () => boolean,
  getRepoPath: () => string | null
): Promise<void> {
  if (isBrowser) return

  // Dynamic import for Node.js modules
  fs = await import('fs')
  path = await import('path')

  fileLoggingInitialized = true
  isEnabledFn = isEnabled
  getRepoPathFn = getRepoPath
}

function writeToFile(level: LogLevel, message: string, args: any[]): void {
  if (isBrowser || !fileLoggingInitialized || !fs || !path) return
  if (!isEnabledFn || !isEnabledFn()) return

  const repoPath = getRepoPathFn?.()
  if (!repoPath) return

  const logPath = path.join(repoPath, '.git', 'teapot-debug.log')

  // Clear on first write this session
  if (!clearedThisSession.has(repoPath)) {
    try {
      fs.writeFileSync(logPath, '')
    } catch {
      // Ignore errors (e.g., .git doesn't exist)
    }
    clearedThisSession.add(repoPath)
  }

  const timestamp = new Date().toISOString()
  const argsStr =
    args.length > 0
      ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      : ''
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${argsStr}\n`

  try {
    fs.appendFileSync(logPath, line)
  } catch {
    // Ignore write errors
  }
}

// --- Existing logger code ---

function getLogLevel(): LogLevel {
  if (isBrowser) return 'info'
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined
  return envLevel && LOG_LEVEL_ORDER.includes(envLevel) ? envLevel : 'info'
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel()
  return LOG_LEVEL_ORDER.indexOf(level) <= LOG_LEVEL_ORDER.indexOf(currentLevel)
}

function format(level: LogLevel, message: any, args: any[]) {
  const style = styles[level]

  // Handle case where message is an object
  const msgStr = typeof message === 'string' ? message : '%o'
  const finalArgs = typeof message === 'string' ? args : [message, ...args]

  if (isBrowser) {
    // Browser: Use %c for styling
    return [
      `%c[${style.label}]%c ${msgStr}`,
      `color: ${style.color}; font-weight: bold`,
      'color: inherit',
      ...finalArgs
    ]
  } else {
    // Node: Use ANSI codes
    return [`${style.ansi}[${style.label}]\x1b[0m`, message, ...args]
  }
}

function getPerformanceNow(): number {
  if (isBrowser) {
    return performance.now()
  }
  // Node.js - use process.hrtime for higher precision
  const [sec, nsec] = process.hrtime()
  return sec * 1000 + nsec / 1e6
}

export const log = {
  info: (message: any, ...args: any[]) => {
    // File logging captures ALL levels when enabled (independent of console log level)
    writeToFile('info', String(message), args)
    if (!shouldLog('info')) return
    console.info(...format('info', message, args))
  },
  warn: (message: any, ...args: any[]) => {
    writeToFile('warn', String(message), args)
    if (!shouldLog('warn')) return
    console.warn(...format('warn', message, args))
  },
  error: (message: any, ...args: any[]) => {
    writeToFile('error', String(message), args)
    if (!shouldLog('error')) return
    console.error(...format('error', message, args))
  },
  debug: (message: any, ...args: any[]) => {
    writeToFile('debug', String(message), args)
    if (!shouldLog('debug')) return
    console.debug(...format('debug', message, args))
  },
  /**
   * Trace-level logging with timing support.
   * Returns the current timestamp (ms) for use in subsequent trace calls.
   *
   * Usage:
   *   const start = log.trace('operation START')
   *   // ... do work ...
   *   log.trace('operation END', { startMs: start }) // logs with duration
   */
  trace: (message: string, extra?: { startMs?: number } & Record<string, unknown>): number => {
    const now = getPerformanceNow()

    // Process message for both file and console
    let msg = message
    const extraCopy = extra ? { ...extra } : undefined

    if (extraCopy?.startMs !== undefined) {
      const durationMs = Math.round(now - extraCopy.startMs)
      msg = `${message} (${durationMs}ms)`
      delete extraCopy.startMs
    }

    const hasExtra = extraCopy && Object.keys(extraCopy).length > 0

    // File logging captures ALL levels when enabled
    writeToFile('trace', msg, hasExtra ? [extraCopy] : [])

    if (!shouldLog('trace')) return now

    if (hasExtra) {
      console.debug(...format('trace', msg, [extraCopy]))
    } else {
      console.debug(...format('trace', msg, []))
    }

    return now
  }
}
