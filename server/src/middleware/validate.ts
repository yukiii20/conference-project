import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'
import { BadRequestError } from '../utils/errors.js'

function fieldsFromZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in fields)) {
      fields[key] = issue.message
    }
  }
  return fields
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new BadRequestError('Please fix the highlighted fields.', fieldsFromZodError(result.error)))
      return
    }
    req.body = result.data
    next()
  }
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      next(new BadRequestError('Please fix the highlighted fields.', fieldsFromZodError(result.error)))
      return
    }
    req.query = result.data as never
    next()
  }
}
