import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import { bookFile, generateBook, getAbstractBookStatus, getPublicBookInfo, setBookPublished } from './service.js'
import { generateBookSchema, publishBookSchema } from './validation.js'

// Generating and publishing the book reuse schedule.manage — the same people
// who build the programme the book can be ordered by.
export const abstractBookRouter = Router()
const PERM = 'schedule.manage'

abstractBookRouter.get('/:id/abstract-book', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await getAbstractBookStatus(req.params.id!))
  } catch (err) {
    next(err)
  }
})

abstractBookRouter.post(
  '/:id/abstract-book/generate',
  requireConferencePermission(PERM),
  validateBody(generateBookSchema),
  async (req, res, next) => {
    try {
      res.json({ book: await generateBook(req.user!.id, req.params.id!, req.body, auditContextFrom(req)) })
    } catch (err) {
      next(err)
    }
  },
)

abstractBookRouter.patch(
  '/:id/abstract-book/publish',
  requireConferencePermission(PERM),
  validateBody(publishBookSchema),
  async (req, res, next) => {
    try {
      await setBookPublished(req.user!.id, req.params.id!, req.body.is_published, auditContextFrom(req))
      res.json({ message: req.body.is_published ? 'Published on the conference page.' : 'Removed from the conference page.' })
    } catch (err) {
      next(err)
    }
  },
)

abstractBookRouter.get('/:id/abstract-book/download', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    const { absolutePath, filename } = await bookFile(req.params.id!, { publicOnly: false })
    res.download(absolutePath, filename)
  } catch (err) {
    next(err)
  }
})

// ---- Public: only once the convenor has switched on "Publish on conference page".
abstractBookRouter.get('/:id/abstract-book/public', async (req, res, next) => {
  try {
    res.json(await getPublicBookInfo(req.params.id!))
  } catch (err) {
    next(err)
  }
})

abstractBookRouter.get('/:id/abstract-book/public.pdf', async (req, res, next) => {
  try {
    const { absolutePath, filename } = await bookFile(req.params.id!, { publicOnly: true })
    res.download(absolutePath, filename)
  } catch (err) {
    next(err)
  }
})
