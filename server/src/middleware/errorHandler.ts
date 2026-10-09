import type { ErrorRequestHandler } from 'express'
import multer from 'multer'
import { AppError } from '../utils/errors.js'

type MysqlError = {
  errno?: number
  sqlState?: string
  sqlMessage?: string
  message: string
}

function isMysqlError(err: unknown): err is MysqlError {
  return Boolean(err && typeof err === 'object' && 'errno' in err)
}

/**
 * Central error handler. Never leaks raw SQL — trigger errors (SQLSTATE
 * 45000) are written in plain English by the triggers themselves, so those
 * are shown as-is; everything else from MySQL is translated to a generic
 * message.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { message: err.message, ...(err.fields ? { fields: err.fields } : {}) } })
    return
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'This file is too large.' : 'Could not read the uploaded file.'
    res.status(400).json({ error: { message } })
    return
  }

  if (isMysqlError(err)) {
    if (err.sqlState === '45000' && err.sqlMessage) {
      res.status(400).json({ error: { message: err.sqlMessage } })
      return
    }
    if (err.errno === 1062) {
      res.status(409).json({ error: { message: 'This already exists.' } })
      return
    }
    if (err.errno === 3819 || err.errno === 4025) {
      // CHECK constraint violation
      res.status(400).json({ error: { message: 'One of the values provided is not valid.' } })
      return
    }
    console.error('Unhandled MySQL error:', err)
    res.status(500).json({ error: { message: 'Something went wrong. Please try again.' } })
    return
  }

  console.error('Unhandled error:', err)
  res.status(500).json({ error: { message: 'Something went wrong. Please try again.' } })
}
