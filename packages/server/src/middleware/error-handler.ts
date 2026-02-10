import type { Context, Next } from 'hono';

/** Application-specific error with HTTP status code */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Convenience factories */
export const NotFound = (msg: string) => new AppError(msg, 404);
export const BadRequest = (msg: string) => new AppError(msg, 400);

/** Hono error handling middleware */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.statusCode as any);
    }

    console.error('[error-handler]', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
