export class AppError extends Error {
  statusCode: number
  fields?: Record<string, string>
  /** Optional machine-readable reason (e.g. 'no_role_at_conference') so the frontend can offer the right next step without parsing the message. */
  code?: string

  constructor(statusCode: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message)
    this.statusCode = statusCode
    this.fields = fields
    this.code = code
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(404, message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this.') {
    super(403, message)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You must be signed in.') {
    super(401, message)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message)
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super(400, message, fields)
  }
}

export function isSignalError(err: unknown): err is { sqlState: string; sqlMessage: string } {
  return Boolean(err && typeof err === 'object' && (err as { sqlState?: string }).sqlState === '45000')
}

/**
 * Trigger SIGNAL 45000 errors (invalid status transition, locked review,
 * locked decision, ...) carry a human-readable message that's safe to show
 * to the user as-is (see database/03_triggers.sql) — map them to a 409
 * instead of letting them surface as a raw 500. Any other error is rethrown
 * unchanged.
 */
export function mapDatabaseError(err: unknown): never {
  if (isSignalError(err)) {
    throw new ConflictError(err.sqlMessage)
  }
  throw err as Error
}
