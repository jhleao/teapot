export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const styles = {
  info: { label: 'INFO', color: '#2ecc71', ansi: '\x1b[32m' },
  warn: { label: 'WARN', color: '#f1c40f', ansi: '\x1b[33m' },
  error: { label: 'ERROR', color: '#e74c3c', ansi: '\x1b[31m' },
  debug: { label: 'DEBUG', color: '#3498db', ansi: '\x1b[34m' }
}

const isBrowser = typeof window !== 'undefined'

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

export const log = {
  info: (message: any, ...args: any[]) => {
    console.info(...format('info', message, args))
  },
  warn: (message: any, ...args: any[]) => {
    console.warn(...format('warn', message, args))
  },
  error: (message: any, ...args: any[]) => {
    console.error(...format('error', message, args))
  },
  debug: (message: any, ...args: any[]) => {
    console.debug(...format('debug', message, args))
  }
}
