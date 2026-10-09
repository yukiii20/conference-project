import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { BadRequestError } from '../../utils/errors.js'
import { getDownloadableFile, uploadSubmissionFile } from './files.service.js'
import {
  addAuthor,
  createSubmission,
  deleteAuthor,
  deleteSubmission,
  getAuthorFormData,
  getSubmissionDetail,
  listMySubmissions,
  submitSubmission,
  updateAuthor,
  updateSubmission,
  withdrawSubmission,
} from './service.js'
import {
  addAuthorSchema,
  createSubmissionSchema,
  isFileKind,
  updateAuthorSchema,
  updateSubmissionSchema,
  withdrawSubmissionSchema,
} from './validation.js'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // hard ceiling; the real per-conference limit is enforced in the service
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single('file')

export const submissionsConferenceRouter = Router()

submissionsConferenceRouter.get('/:id/author-form', requireAuth, async (req, res, next) => {
  try {
    res.json(await getAuthorFormData(req.user!.id, req.params.id!))
  } catch (err) {
    next(err)
  }
})

submissionsConferenceRouter.get('/:id/my-submissions', requireAuth, async (req, res, next) => {
  try {
    res.json({ submissions: await listMySubmissions(req.user!.id, req.params.id!) })
  } catch (err) {
    next(err)
  }
})

submissionsConferenceRouter.post(
  '/:id/submissions',
  requireAuth,
  validateBody(createSubmissionSchema),
  async (req, res, next) => {
    try {
      const result = await createSubmission(req.user!.id, req.params.id!, req.body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

export const submissionsRouter = Router()

submissionsRouter.get('/:sid', requireAuth, async (req, res, next) => {
  try {
    res.json(await getSubmissionDetail(req.user!.id, req.params.sid!))
  } catch (err) {
    next(err)
  }
})

submissionsRouter.patch('/:sid', requireAuth, validateBody(updateSubmissionSchema), async (req, res, next) => {
  try {
    await updateSubmission(req.user!.id, req.params.sid!, req.body)
    res.json(await getSubmissionDetail(req.user!.id, req.params.sid!))
  } catch (err) {
    next(err)
  }
})

submissionsRouter.post('/:sid/submit', requireAuth, async (req, res, next) => {
  try {
    await submitSubmission(req.user!.id, req.params.sid!)
    res.json(await getSubmissionDetail(req.user!.id, req.params.sid!))
  } catch (err) {
    next(err)
  }
})

submissionsRouter.post(
  '/:sid/withdraw',
  requireAuth,
  validateBody(withdrawSubmissionSchema),
  async (req, res, next) => {
    try {
      await withdrawSubmission(req.user!.id, req.params.sid!, req.body.reason)
      res.json(await getSubmissionDetail(req.user!.id, req.params.sid!))
    } catch (err) {
      next(err)
    }
  },
)

submissionsRouter.delete('/:sid', requireAuth, async (req, res, next) => {
  try {
    await deleteSubmission(req.user!.id, req.params.sid!)
    res.json({ message: 'Submission deleted.' })
  } catch (err) {
    next(err)
  }
})

submissionsRouter.post('/:sid/authors', requireAuth, validateBody(addAuthorSchema), async (req, res, next) => {
  try {
    const result = await addAuthor(req.user!.id, req.params.sid!, req.body)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

submissionsRouter.patch(
  '/:sid/authors/:aid',
  requireAuth,
  validateBody(updateAuthorSchema),
  async (req, res, next) => {
    try {
      await updateAuthor(req.user!.id, req.params.sid!, req.params.aid!, req.body)
      res.json({ message: 'Author updated.' })
    } catch (err) {
      next(err)
    }
  },
)

submissionsRouter.delete('/:sid/authors/:aid', requireAuth, async (req, res, next) => {
  try {
    await deleteAuthor(req.user!.id, req.params.sid!, req.params.aid!)
    res.json({ message: 'Author removed.' })
  } catch (err) {
    next(err)
  }
})

submissionsRouter.post('/:sid/files/:kind', requireAuth, uploadRateLimit, upload, async (req, res, next) => {
  try {
    const kind = req.params.kind!
    if (!isFileKind(kind)) throw new BadRequestError('Unknown file kind.')
    if (!req.file) throw new BadRequestError('Choose a file to upload.')
    const result = await uploadSubmissionFile(req.user!.id, req.params.sid!, kind, {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
    })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

submissionsRouter.get('/:sid/files/:fileId/download', requireAuth, async (req, res, next) => {
  try {
    const { absolutePath, filename } = await getDownloadableFile(req.user!.id, req.params.sid!, req.params.fileId!)
    res.download(absolutePath, filename, (err) => {
      if (err) next(err)
    })
  } catch (err) {
    next(err)
  }
})
