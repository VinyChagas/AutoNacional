import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function getLogger(name?: string): pino.Logger {
  return name ? logger.child({ module: name }) : logger;
}

export default logger;
