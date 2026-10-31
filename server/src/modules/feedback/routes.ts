import { Router } from 'express'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { keepBoundConferenceRows } from '../../middleware/sessionScope.js'
import { auditContextFrom } from '../../utils/audit.js'
import { generateFeedbackXlsx } from './export.js'
import {
  getResults,
  getResultsForExport,
  getSurveyAdmin,
  getSurveyForm,
  listMyFeedback,
  saveSurvey,
  sendInvitations,
  setSurveyOpen,
  submitResponse,
} from './service.js'
import { saveSurveySchema, setOpenSchema, submitResponseSchema } from './validation.js'

// Building the survey and reading results reuse conference.manage (the
// convenor). Answering needs only a session: eligibility (checked in,
// chaired, presented) is checked in the service for the signed-in user.
export const feedbackRouter = Router()
const PERM = 'conference.manage'

feedbackRouter.get('/:id/feedback-survey', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await getSurveyAdmin(req.params.id!))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.put('/:id/feedback-survey', requireConferencePermission(PERM), validateBody(saveSurveySchema), async (req, res, next) => {
  try {
    res.json(await saveSurvey(req.user!.id, req.params.id!, req.body, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.patch('/:id/feedback-survey/open', requireConferencePermission(PERM), validateBody(setOpenSchema), async (req, res, next) => {
  try {
    res.json(await setSurveyOpen(req.user!.id, req.params.id!, req.body.is_open, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.post('/:id/feedback-survey/invite', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await sendInvitations(req.user!.id, req.params.id!, auditContextFrom(req)))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.get('/:id/feedback-survey/results', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json(await getResults(req.params.id!))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.get('/:id/feedback-survey/results.xlsx', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    const buffer = await generateFeedbackXlsx(await getResultsForExport(req.params.id!))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="feedback-results.xlsx"')
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

feedbackRouter.get('/:id/feedback-survey/form', requireAuth, async (req, res, next) => {
  try {
    res.json(await getSurveyForm(req.params.id!, req.user!.id))
  } catch (err) {
    next(err)
  }
})

feedbackRouter.post('/:id/feedback-survey/responses', requireAuth, validateBody(submitResponseSchema), async (req, res, next) => {
  try {
    res.status(201).json(await submitResponse(req.params.id!, req.user!.id, req.body))
  } catch (err) {
    next(err)
  }
})

/** Mounted at /api: the surveys the signed-in person can answer right now, across every conference. */
export const feedbackMeRouter = Router()

feedbackMeRouter.get('/me/feedback', requireAuth, async (req, res, next) => {
  try {
    const surveys = await listMyFeedback(req.user!.id)
    res.json({ surveys: keepBoundConferenceRows(surveys, (s) => s.conference_id) })
  } catch (err) {
    next(err)
  }
})
