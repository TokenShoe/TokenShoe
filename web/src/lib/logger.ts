/**
 * Minimal structured logging: one JSON object per line, easy to grep and to ship to a log platform.
 * Usage: log.info('tx.processed', { txHash, events: 3 })
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

function write(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  )
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') write('debug', event, data)
  },
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
}
