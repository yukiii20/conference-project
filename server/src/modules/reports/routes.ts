import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { BadRequestError, ForbiddenError } from '../../utils/errors.js'
import {
  REGISTRATION_REPORT_KINDS,
  canReadAllReviews,
  canReadRegistrations,
  exportReportCsv,
  exportReportXlsx,
  type ReportKind,
} from './service.js'

export const reportsRouter = Router()

const KINDS: ReportKind[] = ['submissions', 'reviews', 'members', 'committees', 'registrations', 'attendance']

function parseKind(value: string): ReportKind {
  if (!KINDS.includes(value as ReportKind)) throw new BadRequestError('Unknown report.')
  return value as ReportKind
}

/** Attendee lists carry names and emails, so they need registration access on top of report.view. */
async function assertCanExport(kind: ReportKind, userId: string, conferenceId: string): Promise<void> {
  if (REGISTRATION_REPORT_KINDS.has(kind) && !(await canReadRegistrations(userId, conferenceId))) {
    throw new ForbiddenError('You do not have access to registration records for this conference.')
  }
}

reportsRouter.get('/:id/reports/:kind/csv', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    const kind = parseKind(req.params.kind!)
    await assertCanExport(kind, req.user!.id, req.params.id!)
    const includeConfidential = kind === 'reviews' ? await canReadAllReviews(req.user!.id, req.params.id!) : false
    const csv = await exportReportCsv(kind, req.params.id!, includeConfidential)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`)
    res.send(csv)
  } catch (err) {
    next(err)
  }
})

reportsRouter.get('/:id/reports/:kind/xlsx', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    const kind = parseKind(req.params.kind!)
    await assertCanExport(kind, req.user!.id, req.params.id!)
    const includeConfidential = kind === 'reviews' ? await canReadAllReviews(req.user!.id, req.params.id!) : false
    const buffer = await exportReportXlsx(kind, req.params.id!, includeConfidential)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.xlsx"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})
