export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export type Logger = (
  level: Exclude<LogLevel, 'silent'>,
  event: string,
  fields?: Record<string, unknown>,
) => void

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
}

export function createLogger(minimumLevel: LogLevel): Logger {
  return (level, event, fields = {}) => {
    if (priorities[level] < priorities[minimumLevel]) {
      return
    }

    const output = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    })

    if (level === 'error') {
      console.error(output)
    } else if (level === 'warn') {
      console.warn(output)
    } else {
      console.log(output)
    }
  }
}
