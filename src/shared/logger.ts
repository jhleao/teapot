import type { FileLogLevel } from './types/ipc'

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
let getFileLogLevelFn: (() => FileLogLevel) | null = null
let getRepoPathFn: (() => string | null) | null = null
const clearedThisSession = new Set<string>()

// Async write buffer
const writeBuffer: string[] = []
let flushScheduled = false
const FLUSH_INTERVAL_MS = 100
const FLUSH_SIZE_THRESHOLD = 50

// Log rotation settings
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_ROTATED_FILES = 3

// Dynamic imports for Node.js only (not available in browser)
let fs: typeof import('fs') | null = null
let path: typeof import('path') | null = null

/**
 * Map FileLogLevel UI options to maximum LogLevel that should be written.
 * - 'off': nothing
 * - 'standard': error, warn, info
 * - 'verbose': error, warn, info, debug
 * - 'everything': error, warn, info, debug, trace
 */
function getMaxLogLevelForFileLevel(fileLevel: FileLogLevel): LogLevel | null {
  switch (fileLevel) {
    case 'off':
      return null
    case 'standard':
      return 'info'
    case 'verbose':
      return 'debug'
    case 'everything':
      return 'trace'
    default: {
      const _exhaustive: never = fileLevel
      return _exhaustive
    }
  }
}

/**
 * Check if a log level should be written to file based on current file log level setting.
 */
function shouldLogToFile(level: LogLevel): boolean {
  if (!getFileLogLevelFn) return false

  const fileLevel = getFileLogLevelFn()
  const maxLevel = getMaxLogLevelForFileLevel(fileLevel)
  if (!maxLevel) return false

  // Check if level is within the allowed range
  const levelIndex = LOG_LEVEL_ORDER.indexOf(level)
  const maxIndex = LOG_LEVEL_ORDER.indexOf(maxLevel)
  return levelIndex <= maxIndex
}

/**
 * Synchronously flush remaining logs to disk.
 * Called on process exit to prevent data loss.
 */
function flushBufferSync(): void {
  if (!fs || !path || writeBuffer.length === 0) return

  const repoPath = getRepoPathFn?.()
  if (!repoPath) return

  const logPath = path.join(repoPath, '.git', 'teapot-debug.log')

  // Drain buffer and write synchronously
  const lines = writeBuffer.splice(0, writeBuffer.length)
  const content = lines.join('')

  try {
    fs.appendFileSync(logPath, content)
  } catch {
    // Ignore write errors on exit
  }
}

/**
 * Initialize file logging (call from main process on startup).
 * @param getFileLogLevel - function to get current file log level setting
 * @param getRepoPath - function to get current repo path
 */
export async function initFileLogging(
  getFileLogLevel: () => FileLogLevel,
  getRepoPath: () => string | null
): Promise<void> {
  if (isBrowser) return

  // Dynamic import for Node.js modules
  fs = await import('fs')
  path = await import('path')

  fileLoggingInitialized = true
  getFileLogLevelFn = getFileLogLevel
  getRepoPathFn = getRepoPath

  // Flush remaining logs on process exit to prevent data loss
  process.on('exit', flushBufferSync)
  process.on('SIGINT', () => {
    flushBufferSync()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    flushBufferSync()
    process.exit(0)
  })
}

/**
 * Rotate log files if the current log exceeds MAX_LOG_SIZE_BYTES.
 * Rotation: .log -> .log.1 -> .log.2 -> .log.3 (deleted)
 */
function rotateLogIfNeeded(logPath: string): void {
  if (!fs || !path) return

  try {
    const stats = fs.statSync(logPath)
    if (stats.size < MAX_LOG_SIZE_BYTES) return

    // Rotate existing files
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const oldPath = i === 1 ? logPath : `${logPath}.${i - 1}`
      const newPath = `${logPath}.${i}`

      try {
        if (i === MAX_ROTATED_FILES) {
          // Delete the oldest file
          fs.unlinkSync(newPath)
        }
      } catch {
        // File doesn't exist, ignore
      }

      try {
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath)
        }
      } catch {
        // Ignore rotation errors
      }
    }
  } catch {
    // File doesn't exist or can't stat, ignore
  }
}

/**
 * Flush the write buffer to disk asynchronously.
 */
function flushBuffer(): void {
  if (!fs || !path || writeBuffer.length === 0) {
    flushScheduled = false
    return
  }

  const repoPath = getRepoPathFn?.()
  if (!repoPath) {
    writeBuffer.length = 0
    flushScheduled = false
    return
  }

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

  // Check for rotation before writing
  rotateLogIfNeeded(logPath)

  // Drain buffer and write
  const lines = writeBuffer.splice(0, writeBuffer.length)
  const content = lines.join('')

  // Use async write to avoid blocking
  fs.appendFile(logPath, content, () => {
    // Ignore write errors
  })

  flushScheduled = false
}

/**
 * Schedule a buffer flush if not already scheduled.
 */
function scheduleFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(flushBuffer, FLUSH_INTERVAL_MS)
}

function writeToFile(level: LogLevel, message: string, args: any[]): void {
  if (isBrowser || !fileLoggingInitialized || !fs || !path) return
  if (!shouldLogToFile(level)) return

  // Skip START logs - only log END with duration (reduces noise by ~50%)
  if (message.endsWith(' START')) return

  const timestamp = new Date().toISOString()
  const argsStr =
    args.length > 0
      ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      : ''
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${argsStr}\n`

  // Add to buffer
  writeBuffer.push(line)

  // Flush immediately if buffer is large, otherwise schedule
  if (writeBuffer.length >= FLUSH_SIZE_THRESHOLD) {
    flushBuffer()
  } else {
    scheduleFlush()
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
