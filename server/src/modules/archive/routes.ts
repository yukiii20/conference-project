import { Router } from 'express'
import multer from 'multer'
import { requireConferencePermission } from '../../middleware/auth.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { sendPrivateFile } from '../../storage/send.js'
import { auditContextFrom } from '../../utils/audit.js'
import {
  REPORT_PDF_MAX_BYTES,
  getArchivePaperFile,
  getPublicArchive,
  getReport,
  getReportPdf,
  removeReportPdf,
  reportTextSchema,
  saveReportText,
  setReportPublished,
  uploadReportPdf,
} from './service.js'

/** changes-nov2, Part 3: past-conference archive and the conference report. Mounted under /api/conferences. */
export const archiveRouter = Router()

const reportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: REPORT_PDF_MAX_BYTES, files: 1 } }).single('file')

// ------------------------------------------------------------------ Public
archiveRouter.get('/:id/archive', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store') // the download links inside expire
    res.json(await getPublicArchive(req.params.id!))
  } catch (err) {
    next(err)
  }
})

archiveRouter.get('/:id/archive/papers/:sid/file', async (req, res, next) => {
  try {
    const file = await getArchivePaperFile(req.params.id!, req.params.sid!, req.query.expires, req.query.sig)
    await sendPrivateFile(res, file.storage_path, file.original_filename, file.mime_type)
  } catch (err) {
    next(err)
  }
})

archiveRouter.get('/:id/archive/report.pdf', async (req, res, next) => {
  try {
    const pdf = await getReportPdf(req.params.id!, { publishedOnly: true })
    await sendPrivateFile(res, pdf.storage_path, pdf.filename, 'application/pdf')
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Convenor: Communication -> Conference report
archiveRouter.get('/:id/conference-report', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    res.json({ report: await getReport(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

archiveRouter.put(
  '/:id/conference-report',
  requireConferencePermission('conference.manage'),
  validateBody(reportTextSchema),
  async (req, res, next) => {
    try {
      await saveReportText(req.user!.id, req.params.id!, req.body.body_text, auditContextFrom(req))
      res.json({ message: 'Report saved.' })
    } catch (err) {
      next(err)
    }
  },
)

archiveRouter.post('/:id/conference-report/pdf', requireConferencePermission('conference.manage'), uploadRateLimit, reportUpload, async (req, res, next) => {
  try {
    await uploadReportPdf(req.user!.id, req.params.id!, req.file, auditContextFrom(req))
    res.status(201).json({ message: 'PDF uploaded.' })
  } catch (err) {
    next(err)
  }
})

archiveRouter.delete('/:id/conference-report/pdf', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    await removeReportPdf(req.user!.id, req.params.id!, auditContextFrom(req))
    res.json({ message: 'PDF removed.' })
  } catch (err) {
    next(err)
  }
})

archiveRouter.get('/:id/conference-report/pdf', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    const pdf = await getReportPdf(req.params.id!, { publishedOnly: false })
    await sendPrivateFile(res, pdf.storage_path, pdf.filename, 'application/pdf')
  } catch (err) {
    next(err)
  }
})

archiveRouter.post('/:id/conference-report/publish', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    await setReportPublished(req.user!.id, req.params.id!, true, auditContextFrom(req))
    res.json({ message: 'Report published.' })
  } catch (err) {
    next(err)
  }
})

archiveRouter.post('/:id/conference-report/unpublish', requireConferencePermission('conference.manage'), async (req, res, next) => {
  try {
    await setReportPublished(req.user!.id, req.params.id!, false, auditContextFrom(req))
    res.json({ message: 'Report unpublished.' })
  } catch (err) {
    next(err)
  }
})
