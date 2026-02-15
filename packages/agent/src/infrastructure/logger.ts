import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level,
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
