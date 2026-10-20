/**
 * Small, serialisable error type used across the API layer.
 * The HTTP status is a hint for our own server, not something we blindly
 * forward to the browser -- upstream utilities are often the ones failing.
 */
export class AppError extends Error {
  constructor(code, message, { status = 502, retryable = true, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export const badRequest = (message) =>
  new AppError('BAD_REQUEST', message, { status: 400, retryable: false });

export const notFound = (message) =>
  new AppError('NOT_FOUND', message, { status: 404, retryable: false });

export const rateLimited = (retryAfterSeconds) =>
  new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', {
    status: 429,
    retryable: true,
    details: { retryAfterSeconds },
  });

export const upstreamError = (message, details) =>
  new AppError('UPSTREAM_ERROR', message, { status: 502, retryable: true, details });

export const upstreamUnreachable = (details) =>
  new AppError(
    'UPSTREAM_UNREACHABLE',
    'Could not reach the utility portal. It may be down, blocked, or unreachable from this network.',
    { status: 504, retryable: true, details },
  );

export const accountNotFound = (provider) =>
  new AppError(
    'ACCOUNT_NOT_FOUND',
    `No ${provider.toUpperCase()} prepaid account was found for that number.`,
    { status: 404, retryable: false },
  );
