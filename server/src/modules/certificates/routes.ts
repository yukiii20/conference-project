import { Router } from 'express'
import { requireAuth, requireConferencePermission, assertConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { imageUpload, processImage } from '../../storage/imageUpload.js'
import { auditContextFrom } from '../../utils/audit.js'
import { BadRequestError } from '../../utils/errors.js'
import {
  downloadCertificate,
  generateCertificates,
  issueBestPaperCertificates,
  issueSpeakerCertificate,
  listCertificates,
  listMyCertificates,
  listTemplates,
  previewEligibleCount,
  previewTemplatePdf,
  releaseNow,
  removeSignatorySignature,
  removeTemplateBackground,
  revokeCertificate,
  setSignatorySignature,
  setTemplateBackground,
  updateTemplate,
  createTemplate,
  verifyCertificate,
} from './service.js'
import {
  certificateTemplateSchema,
  generateCertificatesSchema,
  issueBestPaperSchema,
  issueSpeakerCertificateSchema,
  revokeCertificateSchema,
} from './validation.js'

const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024
const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024

export const certificatesRouter = Router()

// ------------------------------------------------------------- Templates
certificatesRouter.get('/:id/certificate-templates', requireConferencePermission('certificate.manage'), async (req, res, next) => {
  try {
    res.json({ templates: await listTemplates(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

certificatesRouter.post(
  '/:id/certificate-templates',
  requireConferencePermission('certificate.manage'),
  validateBody(certificateTemplateSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await createTemplate(req.user!.id, req.params.id!, req.body, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.patch(
  '/:id/certificate-templates/:templateId',
  requireConferencePermission('certificate.manage'),
  validateBody(certificateTemplateSchema),
  async (req, res, next) => {
    try {
      await updateTemplate(req.user!.id, req.params.id!, req.params.templateId!, req.body, auditContextFrom(req))
      res.json({ message: 'Template updated.' })
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post(
  '/:id/certificate-templates/:templateId/background',
  requireConferencePermission('certificate.manage'),
  uploadRateLimit,
  imageUpload(BACKGROUND_MAX_BYTES),
  async (req, res, next) => {
    try {
      if (!req.file) throw new BadRequestError('Choose an image to upload.')
      const processed = await processImage(req.file.buffer)
      res.json(await setTemplateBackground(req.user!.id, req.params.id!, req.params.templateId!, processed, auditContextFrom(req)))
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.delete(
  '/:id/certificate-templates/:templateId/background',
  requireConferencePermission('certificate.manage'),
  async (req, res, next) => {
    try {
      await removeTemplateBackground(req.user!.id, req.params.id!, req.params.templateId!, auditContextFrom(req))
      res.json({ message: 'Removed.' })
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post(
  '/:id/certificate-templates/:templateId/signatories/:index/signature',
  requireConferencePermission('certificate.manage'),
  uploadRateLimit,
  imageUpload(SIGNATURE_MAX_BYTES),
  async (req, res, next) => {
    try {
      if (!req.file) throw new BadRequestError('Choose an image to upload.')
      const processed = await processImage(req.file.buffer)
      const index = Number(req.params.index)
      await setSignatorySignature(req.user!.id, req.params.id!, req.params.templateId!, index, processed, auditContextFrom(req))
      res.json({ message: 'Signature uploaded.' })
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.delete(
  '/:id/certificate-templates/:templateId/signatories/:index/signature',
  requireConferencePermission('certificate.manage'),
  async (req, res, next) => {
    try {
      const index = Number(req.params.index)
      await removeSignatorySignature(req.user!.id, req.params.id!, req.params.templateId!, index, auditContextFrom(req))
      res.json({ message: 'Removed.' })
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.get(
  '/:id/certificate-templates/:templateId/preview.pdf',
  requireConferencePermission('certificate.manage'),
  async (req, res, next) => {
    try {
      const pdf = await previewTemplatePdf(req.params.id!, req.params.templateId!)
      res.setHeader('Content-Type', 'application/pdf')
      res.send(pdf)
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------- Eligibility / issuing
certificatesRouter.get(
  '/:id/certificates/preview',
  requireConferencePermission('certificate.manage'),
  async (req, res, next) => {
    try {
      const type = req.query.type
      const parsed = generateCertificatesSchema.pick({ certificate_type: true }).safeParse({ certificate_type: type })
      if (!parsed.success) throw new BadRequestError('Choose a valid certificate type.')
      res.json(await previewEligibleCount(req.params.id!, parsed.data.certificate_type))
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post(
  '/:id/certificates/generate',
  requireConferencePermission('certificate.manage'),
  validateBody(generateCertificatesSchema),
  async (req, res, next) => {
    try {
      res.json(
        await generateCertificates(req.user!.id, req.params.id!, req.body.certificate_type, req.body.template_id, auditContextFrom(req)),
      )
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post(
  '/:id/certificates/best-paper',
  requireConferencePermission('certificate.manage'),
  validateBody(issueBestPaperSchema),
  async (req, res, next) => {
    try {
      res.json(
        await issueBestPaperCertificates(req.user!.id, req.params.id!, req.body.submission_id, req.body.template_id, auditContextFrom(req)),
      )
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post(
  '/:id/certificates/speaker',
  requireConferencePermission('certificate.manage'),
  validateBody(issueSpeakerCertificateSchema),
  async (req, res, next) => {
    try {
      res.json(
        await issueSpeakerCertificate(req.user!.id, req.params.id!, req.body.speaker_id, req.body.template_id, auditContextFrom(req)),
      )
    } catch (err) {
      next(err)
    }
  },
)

certificatesRouter.post('/:id/certificates/release-now', requireConferencePermission('certificate.manage'), async (req, res, next) => {
  try {
    await releaseNow(req.user!.id, req.params.id!, auditContextFrom(req))
    res.json({ message: 'Certificates released.' })
  } catch (err) {
    next(err)
  }
})

certificatesRouter.get('/:id/certificates', requireConferencePermission('certificate.manage'), async (req, res, next) => {
  try {
    res.json({ certificates: await listCertificates(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

certificatesRouter.patch(
  '/:id/certificates/:certificateId/revoke',
  requireConferencePermission('certificate.manage'),
  validateBody(revokeCertificateSchema),
  async (req, res, next) => {
    try {
      await revokeCertificate(req.user!.id, req.params.id!, req.params.certificateId!, req.body.reason, auditContextFrom(req))
      res.json({ message: 'Certificate revoked.' })
    } catch (err) {
      next(err)
    }
  },
)

// -------------------------------------------------------------- Recipients
certificatesRouter.get('/:id/my-certificates', requireAuth, async (req, res, next) => {
  try {
    res.json({ certificates: await listMyCertificates(req.params.id!, req.user!.id) })
  } catch (err) {
    next(err)
  }
})

certificatesRouter.get('/:id/certificates/:certificateId/download', requireAuth, async (req, res, next) => {
  try {
    let hasManagePermission = true
    try {
      await assertConferencePermission(req.user!.id, req.params.id!, 'certificate.manage')
    } catch {
      hasManagePermission = false
    }
    const { absolutePath, filename } = await downloadCertificate(req.params.id!, req.params.certificateId!, req.user!.id, hasManagePermission)
    res.download(absolutePath, filename)
  } catch (err) {
    next(err)
  }
})

export const certificatesPublicRouter = Router()

certificatesPublicRouter.get('/verify/:token', async (req, res, next) => {
  try {
    const result = await verifyCertificate(req.params.token!)
    res.json({ result })
  } catch (err) {
    next(err)
  }
})
