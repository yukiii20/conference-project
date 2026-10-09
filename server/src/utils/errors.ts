export class AppError extends Error {
  statusCode: number
  fields?: Record<string, string>

  constructor(statusCode: number, message: string, fields?: Record<string, string>) {
    super(message)
    this.statusCode = statusCode
    this.fields = fields
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
