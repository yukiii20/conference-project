import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { BadRequestError } from '../../utils/errors.js'
import { canReadAllReviews, exportReportCsv, exportReportXlsx, type ReportKind } from './service.js'

export const reportsRouter = Router()

const KINDS: ReportKind[] = ['submissions', 'reviews', 'members', 'committees']

function parseKind(value: string): ReportKind {
  if (!KINDS.includes(value as ReportKind)) throw new BadRequestError('Unknown report.')
  return value as ReportKind
}

reportsRouter.get('/:id/reports/:kind/csv', requireConferencePermission('report.view'), async (req, res, next) => {
  try {
    const kind = parseKind(req.params.kind!)
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
    const includeConfidential = kind === 'reviews' ? await canReadAllReviews(req.user!.id, req.params.id!) : false
    const buffer = await exportReportXlsx(kind, req.params.id!, includeConfidential)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.xlsx"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})
