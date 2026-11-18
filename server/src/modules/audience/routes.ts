import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { auditContextFrom } from '../../utils/audit.js'
import { NotFoundError } from '../../utils/errors.js'
import { validateBody } from '../../middleware/validate.js'
import { qaAskRateLimit, qaVoteRateLimit, uploadRateLimit } from '../../middleware/rateLimit.js'
import { sendPrivateFile } from '../../storage/send.js'
import {
  askQuestion,
  askQuestionSchema,
  assertCanModerate,
  listAudienceQuestions,
  listModeratorQuestions,
  moderateQuestion,
  moderateQuestionSchema,
  parseSort,
  setVote,
} from './qa.js'
import {
  assertFullScope,
  conferenceFeedbackSchema,
  feedbackCsv,
  getFeedbackScope,
  getFeedbackSummary,
  getMyFeedback,
  moderateFeedback,
  moderateFeedbackSchema,
  parseFeedbackFilters,
  saveConferenceFeedback,
  saveSessionRating,
  sessionRatingSchema,
} from './feedback.js'
import {
  MATERIAL_MAX_BYTES,
  assertMaterialKind,
  consentSchema,
  createMaterial,
  createMaterialSchema,
  deleteMaterial,
  getAudienceConsent,
  getAudienceDownload,
  getMaterialFileForOrganiser,
  listAudienceMaterials,
  listMaterials,
  setAudienceConsent,
  updateMaterial,
  updateMaterialSchema,
} from './materials.js'
import {
  assertAudienceAbstractsOn,
  assertPublicAbstractsOn,
  audienceSettingsSchema,
  listAcceptedAbstracts,
  parseAbstractFilters,
  readAudienceSettings,
  saveAudienceSettings,
} from './abstracts.js'

import { getAudienceProgramme, getAudienceSpeakers, joinOnline } from './programme.js'
import { getCertificateProgress } from './certificateProgress.js'
import { audienceQuestionsCsv, audienceReportCsv, getAudienceReport } from './report.js'
import { resendTicketEmail } from './ticket.js'
import { getMyTicket } from './ticketService.js'

/**
 * Audience features, mounted at /api/conferences. Every route is either the caller's OWN data
 * (requireAuth + "own row" in the service, like my-registration) or guarded by an
 * audience.* permission (requireConferencePermission) - see tests/audienceMatrix.test.ts.
 */
export const audienceRouter = Router()

// Conference materials (convenor upload): one file, at most 25 MB, sniffed in the service.
const materialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MATERIAL_MAX_BYTES, files: 1 } }).single('file')

// ------------------------------------------------------------------ Ticket
audienceRouter.get('/:id/my-ticket', requireAuth, async (req, res, next) => {
  try {
    const ticket = await getMyTicket(req.params.id!, req.user!.id)
    if (!ticket) throw new NotFoundError('You do not have an active registration for this conference.')
    res.setHeader('Cache-Control', 'no-store')
    res.json(ticket)
  } catch (err) {
    next(err)
  }
})

audienceRouter.post('/:id/my-ticket/email', requireAuth, async (req, res, next) => {
  try {
    assertConferenceInSession(req.params.id!)
    await resendTicketEmail(req.params.id!, req.user!.id, auditContextFrom(req))
    res.json({ message: 'Your ticket is on its way to your email.' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Programme & speakers
audienceRouter.get('/:id/audience/programme', requireConferencePermission('audience.view_content'), async (req, res, next) => {
  try {
    res.json(await getAudienceProgramme(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience/speakers', requireConferencePermission('audience.view_content'), async (req, res, next) => {
  try {
    res.json({ speakers: await getAudienceSpeakers(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

// "Join online": returns the private link (never cached) and records online attendance.
audienceRouter.post(
  '/:id/audience/sessions/:sessionId/join-online',
  requireConferencePermission('audience.view_content'),
  async (req, res, next) => {
    try {
      const result = await joinOnline(req.params.id!, req.params.sessionId!, req.user!.id)
      res.setHeader('Cache-Control', 'no-store')
      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Q&A (Audience)
audienceRouter.get(
  '/:id/audience/sessions/:sessionId/questions',
  requireConferencePermission('audience.view_content'),
  async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json(await listAudienceQuestions(req.params.id!, req.params.sessionId!, req.user!.id, parseSort(req.query.sort)))
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.post(
  '/:id/audience/sessions/:sessionId/questions',
  requireConferencePermission('audience.ask_question'),
  qaAskRateLimit,
  validateBody(askQuestionSchema),
  async (req, res, next) => {
    try {
      const { id } = await askQuestion(req.params.id!, req.params.sessionId!, req.user!.id, req.body)
      res.status(201).json({ id, message: 'Your question has been posted.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.put(
  '/:id/audience/questions/:questionId/vote',
  requireConferencePermission('audience.ask_question'),
  qaVoteRateLimit,
  async (req, res, next) => {
    try {
      res.json(await setVote(req.params.id!, req.params.questionId!, req.user!.id, true))
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete(
  '/:id/audience/questions/:questionId/vote',
  requireConferencePermission('audience.ask_question'),
  qaVoteRateLimit,
  async (req, res, next) => {
    try {
      res.json(await setVote(req.params.id!, req.params.questionId!, req.user!.id, false))
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Q&A moderation
// The session's chair/co-chair, or audience.moderate (convenor, manager). Not a single
// permission, so requireAuth + assertCanModerate (same pattern as the chair attendance view).
audienceRouter.get('/:id/sessions/:sessionId/questions/moderate', requireAuth, async (req, res, next) => {
  try {
    await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
    const status = ['visible', 'answered', 'hidden'].includes(String(req.query.status))
      ? (req.query.status as 'visible' | 'answered' | 'hidden')
      : undefined
    res.setHeader('Cache-Control', 'no-store')
    res.json(await listModeratorQuestions(req.params.id!, req.params.sessionId!, parseSort(req.query.sort), status))
  } catch (err) {
    next(err)
  }
})

audienceRouter.patch(
  '/:id/sessions/:sessionId/questions/:questionId',
  requireAuth,
  validateBody(moderateQuestionSchema),
  async (req, res, next) => {
    try {
      await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
      await moderateQuestion(req.user!.id, req.params.id!, req.params.sessionId!, req.params.questionId!, req.body.status, auditContextFrom(req))
      res.json({ message: 'Updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete('/:id/sessions/:sessionId/questions/:questionId', requireAuth, async (req, res, next) => {
  try {
    await assertCanModerate(req.user!.id, req.params.id!, req.params.sessionId!)
    await moderateQuestion(req.user!.id, req.params.id!, req.params.sessionId!, req.params.questionId!, 'deleted', auditContextFrom(req))
    res.json({ message: 'Question deleted.' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Feedback (Audience)
audienceRouter.get('/:id/audience/feedback', requireConferencePermission('audience.give_feedback'), async (req, res, next) => {
  try {
    res.json(await getMyFeedback(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

audienceRouter.put(
  '/:id/audience/feedback',
  requireConferencePermission('audience.give_feedback'),
  validateBody(conferenceFeedbackSchema),
  async (req, res, next) => {
    try {
      const { created } = await saveConferenceFeedback(req.params.id!, req.user!.id, req.body)
      res.status(created ? 201 : 200).json({ message: created ? 'Thank you for your feedback.' : 'Your feedback has been updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.put(
  '/:id/audience/sessions/:sessionId/rating',
  requireConferencePermission('audience.give_feedback'),
  validateBody(sessionRatingSchema),
  async (req, res, next) => {
    try {
      const { created } = await saveSessionRating(req.params.id!, req.params.sessionId!, req.user!.id, req.body)
      res.status(created ? 201 : 200).json({ message: created ? 'Thanks for rating this session.' : 'Your rating has been updated.' })
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Feedback (organisers)
// Organisers (audience.moderate) see everything; a chair sees ratings of their own sessions
// only. requireAuth + getFeedbackScope, since it is "a permission OR chair of something".
audienceRouter.get('/:id/audience-feedback', requireAuth, async (req, res, next) => {
  try {
    const scope = await getFeedbackScope(req.user!.id, req.params.id!)
    res.setHeader('Cache-Control', 'no-store')
    res.json(await getFeedbackSummary(req.params.id!, scope, parseFeedbackFilters(req.query as Record<string, unknown>)))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience-feedback/export.csv', requireAuth, async (req, res, next) => {
  try {
    const scope = await getFeedbackScope(req.user!.id, req.params.id!)
    const summary = await getFeedbackSummary(req.params.id!, scope, parseFeedbackFilters(req.query as Record<string, unknown>))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audience-feedback.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.send('\uFEFF' + feedbackCsv(summary))
  } catch (err) {
    next(err)
  }
})

audienceRouter.patch(
  '/:id/audience-feedback/:kind/:itemId',
  requireConferencePermission('audience.moderate'),
  validateBody(moderateFeedbackSchema),
  async (req, res, next) => {
    try {
      const kind = req.params.kind === 'conference' ? 'conference' : req.params.kind === 'session' ? 'session' : null
      if (!kind) throw new NotFoundError('Not found.')
      assertFullScope(await getFeedbackScope(req.user!.id, req.params.id!))
      await moderateFeedback(req.user!.id, req.params.id!, kind, req.params.itemId!, req.body.status, auditContextFrom(req))
      res.json({ message: 'Updated.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete('/:id/audience-feedback/:kind/:itemId', requireConferencePermission('audience.moderate'), async (req, res, next) => {
  try {
    const kind = req.params.kind === 'conference' ? 'conference' : req.params.kind === 'session' ? 'session' : null
    if (!kind) throw new NotFoundError('Not found.')
    await moderateFeedback(req.user!.id, req.params.id!, kind, req.params.itemId!, 'deleted', auditContextFrom(req))
    res.json({ message: 'Feedback deleted.' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Audience settings (convenor, manager)
audienceRouter.get('/:id/audience-settings', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    res.json({ settings: await readAudienceSettings(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

audienceRouter.put(
  '/:id/audience-settings',
  requireConferencePermission('conference.manage'),
  validateBody(audienceSettingsSchema),
  async (req, res, next) => {
    try {
      await saveAudienceSettings(req.user!.id, req.params.id!, req.body, auditContextFrom(req))
      res.json({ message: 'Audience settings saved.', settings: await readAudienceSettings(req.params.id!) })
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Materials (convenor, manager)
audienceRouter.get('/:id/materials', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    res.json({ materials: await listMaterials(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

audienceRouter.post('/:id/materials', requireConferencePermission('conference.manage'), uploadRateLimit, materialUpload, async (req, res, next) => {
  try {
    const input = createMaterialSchema.safeParse({ title: req.body?.title ?? '', description: req.body?.description ?? null })
    if (!input.success) {
      const issue = input.error.issues[0]
      const field = String(issue?.path[0] ?? 'title')
      res.status(400).json({ error: { message: issue?.message ?? 'Check the form.', fields: { [field]: issue?.message } } })
      return
    }
    const { id } = await createMaterial(req.user!.id, req.params.id!, input.data, req.file, auditContextFrom(req))
    res.status(201).json({ id, message: 'File uploaded.' })
  } catch (err) {
    next(err)
  }
})

audienceRouter.patch(
  '/:id/materials/:materialId',
  requireConferencePermission('conference.manage'),
  validateBody(updateMaterialSchema),
  async (req, res, next) => {
    try {
      await updateMaterial(req.user!.id, req.params.id!, req.params.materialId!, req.body, auditContextFrom(req))
      res.json({ message: 'Saved.' })
    } catch (err) {
      next(err)
    }
  },
)

audienceRouter.delete('/:id/materials/:materialId', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    await deleteMaterial(req.user!.id, req.params.id!, req.params.materialId!, auditContextFrom(req))
    res.json({ message: 'File deleted.' })
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/materials/:materialId/download', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    const file = await getMaterialFileForOrganiser(req.params.id!, req.params.materialId!)
    await sendPrivateFile(res, file.storage_path, file.original_filename, file.mime_type)
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Materials (Audience)
audienceRouter.get('/:id/audience/materials', requireConferencePermission('audience.download_materials'), async (req, res, next) => {
  try {
    res.json({ materials: await listAudienceMaterials(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

audienceRouter.get(
  '/:id/audience/materials/:kind/:itemId/download',
  requireConferencePermission('audience.download_materials'),
  async (req, res, next) => {
    try {
      const file = await getAudienceDownload(req.params.id!, req.user!.id, assertMaterialKind(req.params.kind), req.params.itemId!)
      await sendPrivateFile(res, file.storage_path, file.filename, file.mime_type)
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Author consent for Audience downloads
// Only an author of the paper (checked in the service; anyone else gets 404).
audienceRouter.get('/:id/submissions/:submissionId/audience-consent', requireAuth, async (req, res, next) => {
  try {
    res.json(await getAudienceConsent(req.user!.id, req.params.id!, req.params.submissionId!))
  } catch (err) {
    next(err)
  }
})

audienceRouter.put('/:id/submissions/:submissionId/audience-consent', requireAuth, validateBody(consentSchema), async (req, res, next) => {
  try {
    await setAudienceConsent(req.user!.id, req.params.id!, req.params.submissionId!, req.body, auditContextFrom(req))
    res.json({ message: 'Saved.', ...(await getAudienceConsent(req.user!.id, req.params.id!, req.params.submissionId!)) })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Accepted abstracts
audienceRouter.get('/:id/audience/abstracts', requireConferencePermission('audience.view_accepted_abstracts'), async (req, res, next) => {
  try {
    await assertAudienceAbstractsOn(req.params.id!)
    res.json(await listAcceptedAbstracts(req.params.id!, parseAbstractFilters(req.query as Record<string, unknown>)))
  } catch (err) {
    next(err)
  }
})

// Public: only when the organisers switched "show on the public page" on (off by default).
audienceRouter.get('/:id/abstracts/public', async (req, res, next) => {
  try {
    await assertPublicAbstractsOn(req.params.id!)
    res.json(await listAcceptedAbstracts(req.params.id!, parseAbstractFilters(req.query as Record<string, unknown>)))
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Certificate progress (Audience)
audienceRouter.get('/:id/audience/certificate-progress', requireConferencePermission('audience.view_content'), async (req, res, next) => {
  try {
    res.json(await getCertificateProgress(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Audience report (convenor, manager)
audienceRouter.get('/:id/audience-report', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    res.json(await getAudienceReport(req.params.id!))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience-report/export.csv', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    const report = await getAudienceReport(req.params.id!)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audience-report.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.send('\uFEFF' + audienceReportCsv(report))
  } catch (err) {
    next(err)
  }
})

audienceRouter.get('/:id/audience-report/questions.csv', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    const csv = await audienceQuestionsCsv(req.params.id!)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audience-questions.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.send('﻿' + csv)
  } catch (err) {
    next(err)
  }
})
