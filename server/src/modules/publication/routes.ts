import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { auditContextFrom } from '../../utils/audit.js'
import {
  getPaperPublication,
  getPublicationInfo,
  getPublicPublicationInfo,
  listPaperPublications,
  publishAllFinalApproved,
  setPaperPublication,
  updatePublicationInfo,
} from './service.js'
import { paperPublicationSchema, publicationInfoSchema, publishAllSchema } from './validation.js'

/** changes-nov2, Part 4: publication information. Mounted under /api/conferences. */
export const publicationRouter = Router()

// Public: the conference page "Publication" section (null when nothing is filled in).
publicationRouter.get('/:id/publication-info/public', async (req, res, next) => {
  try {
    res.json({ publication: await getPublicPublicationInfo(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

publicationRouter.get('/:id/publication-info', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    res.json({ publication: await getPublicationInfo(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

publicationRouter.put(
  '/:id/publication-info',
  requireConferencePermission('conference.manage'),
  validateBody(publicationInfoSchema),
  async (req, res, next) => {
    try {
      await updatePublicationInfo(req.user!.id, req.params.id!, req.body, auditContextFrom(req))
      res.json({ message: 'Publication information saved.' })
    } catch (err) {
      next(err)
    }
  },
)

publicationRouter.get('/:id/paper-publications', requireConferencePermission('submission.read_all'), async (req, res, next) => {
  try {
    res.json({ papers: await listPaperPublications(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

publicationRouter.get(
  '/:id/submissions/:sid/publication',
  requireConferencePermission('submission.read_all'),
  async (req, res, next) => {
    try {
      res.json({ publication: await getPaperPublication(req.params.id!, req.params.sid!) })
    } catch (err) {
      next(err)
    }
  },
)

publicationRouter.put(
  '/:id/submissions/:sid/publication',
  requireConferencePermission('submission.manage'),
  validateBody(paperPublicationSchema),
  async (req, res, next) => {
    try {
      await setPaperPublication(req.user!.id, req.params.id!, req.params.sid!, req.body, auditContextFrom(req))
      res.json({ message: 'Publication saved.' })
    } catch (err) {
      next(err)
    }
  },
)

publicationRouter.post(
  '/:id/paper-publications/publish-all',
  requireConferencePermission('submission.manage'),
  validateBody(publishAllSchema),
  async (req, res, next) => {
    try {
      const { published } = await publishAllFinalApproved(req.user!.id, req.params.id!, req.body, auditContextFrom(req))
      res.json({ published, message: published === 1 ? '1 paper marked as published.' : `${published} papers marked as published.` })
    } catch (err) {
      next(err)
    }
  },
)
