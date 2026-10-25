/**
 * Structured JSON logs, one line per event (design 17). Never pass personal
 * data or tokens: callers log ids, codes and timings only.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(level: Level = 'info', base: Record<string, unknown> = {}, sink: (line: string) => void = l => process.stdout.write(l + '\n')): Logger {
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: f => createLogger(level, { ...base, ...f }, sink),
  };
}

export const silentLogger: Logger = createLogger('error', {}, () => {});
