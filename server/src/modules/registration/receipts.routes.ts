import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { requireAuth, requireConferencePermission } from '../../middleware/auth.js'
import { refuseWhenConferenceEnded } from '../../middleware/conferenceEnded.js'
import { uploadRateLimit } from '../../middleware/rateLimit.js'
import { validateBody } from '../../middleware/validate.js'
import { sendPrivateFile } from '../../storage/send.js'
import { auditContextFrom } from '../../utils/audit.js'
import { AppError } from '../../utils/errors.js'
import {
  PAYMENT_QR_MAX_BYTES,
  RECEIPT_MAX_BYTES,
  getMyReceiptFile,
  getPaymentQrFile,
  getPaymentSettings,
  getPublicPaymentInfo,
  getRegistrationReceiptFile,
  paymentSettingsSchema,
  qrTokenForSignedLink,
  rejectRegistrationReceipt,
  rejectSchema,
  removePaymentQr,
  savePaymentInstructions,
  uploadMyReceipt,
  uploadPaymentQr,
} from './receipts.js'
import { confirmRegistration } from './service.js'

/** changes-nov2, Part 6: payment instructions, receipts, confirm/reject. Mounted under /api/conferences. */
export const receiptsRouter = Router()

const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RECEIPT_MAX_BYTES, files: 1, fields: 10 } }).single('file')
const qrUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PAYMENT_QR_MAX_BYTES, files: 1 } }).single('file')

/** multer's "file too large" becomes the same 400 the size check gives. */
function withUpload(upload: RequestHandler, message: string): RequestHandler {
  return (req, res, next) =>
    upload(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, message, { file: message }))
      next(err)
    })
}

// ------------------------------------------------------------------ Payment settings (Attendance)
receiptsRouter.get('/:id/payment-settings', requireConferencePermission('registration.read_all'), async (req, res, next) => {
  try {
    res.json(await getPaymentSettings(req.params.id!))
  } catch (err) {
    next(err)
  }
})

receiptsRouter.put('/:id/payment-settings', requireConferencePermission('registration.manage'), validateBody(paymentSettingsSchema), async (req, res, next) => {
  try {
    await savePaymentInstructions(req.user!.id, req.params.id!, req.body.payment_instructions, auditContextFrom(req))
    res.json({ message: 'Payment instructions saved.' })
  } catch (err) {
    next(err)
  }
})

receiptsRouter.post(
  '/:id/payment-settings/qr',
  requireConferencePermission('registration.manage'),
  uploadRateLimit,
  withUpload(qrUpload, 'The image must be 2 MB or smaller.'),
  async (req, res, next) => {
    try {
      await uploadPaymentQr(req.user!.id, req.params.id!, req.file, auditContextFrom(req))
      res.status(201).json({ message: 'Payment QR uploaded.' })
    } catch (err) {
      next(err)
    }
  },
)

receiptsRouter.delete('/:id/payment-settings/qr', requireConferencePermission('registration.manage'), async (req, res, next) => {
  try {
    await removePaymentQr(req.user!.id, req.params.id!, auditContextFrom(req))
    res.json({ message: 'Payment QR removed.' })
  } catch (err) {
    next(err)
  }
})

// Public: shown on the registration form for paid categories.
receiptsRouter.get('/:id/payment-info/public', async (req, res, next) => {
  try {
    res.json(await getPublicPaymentInfo(req.params.id!))
  } catch (err) {
    next(err)
  }
})

receiptsRouter.get('/:id/payment-info/qr', async (req, res, next) => {
  try {
    await getPublicPaymentInfo(req.params.id!) // 404 for a draft conference
    const qr = await getPaymentQrFile(req.params.id!)
    await sendPrivateFile(res, qr.path, `payment-qr.${qr.mime === 'image/png' ? 'png' : 'jpg'}`, qr.mime, { disposition: 'inline' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Participant: my receipt
receiptsRouter.post(
  '/:id/my-registration/receipt',
  requireAuth,
  refuseWhenConferenceEnded,
  uploadRateLimit,
  withUpload(receiptUpload, 'The receipt must be 5 MB or smaller.'),
  async (req, res, next) => {
    try {
      await uploadMyReceipt(req.user!.id, req.params.id!, req.file, req.body, auditContextFrom(req))
      res.status(201).json({ message: 'Receipt uploaded. The organisers will confirm your registration.' })
    } catch (err) {
      next(err)
    }
  },
)

receiptsRouter.get('/:id/my-registration/receipt', requireAuth, async (req, res, next) => {
  try {
    const file = await getMyReceiptFile(req.params.id!, req.user!.id)
    await sendPrivateFile(res, file.path, file.filename, file.mime, { disposition: 'inline' })
  } catch (err) {
    next(err)
  }
})

// ------------------------------------------------------------------ Organisers
// Receipts are private: the registrant (route above) and convenor/managers (registration.manage) - not staff.
receiptsRouter.get('/:id/registrations/:registrationId/receipt', requireConferencePermission('registration.manage'), async (req, res, next) => {
  try {
    const file = await getRegistrationReceiptFile(req.params.id!, req.params.registrationId!)
    await sendPrivateFile(res, file.path, file.filename, file.mime, { disposition: 'inline' })
  } catch (err) {
    next(err)
  }
})

receiptsRouter.post(
  '/:id/registrations/:registrationId/reject',
  requireConferencePermission('registration.manage'),
  validateBody(rejectSchema),
  async (req, res, next) => {
    try {
      await rejectRegistrationReceipt(req.user!.id, req.params.id!, req.params.registrationId!, req.body.reason, auditContextFrom(req))
      res.json({ message: 'Receipt rejected. The participant was emailed the reason.' })
    } catch (err) {
      next(err)
    }
  },
)

const bulkConfirmSchema = z.object({ registration_ids: z.array(z.string().uuid()).min(1, 'Choose at least one registration.').max(200) })

receiptsRouter.post(
  '/:id/registrations/bulk-confirm',
  requireConferencePermission('registration.manage'),
  validateBody(bulkConfirmSchema),
  async (req, res, next) => {
    try {
      const ctx = auditContextFrom(req)
      let confirmed = 0
      const failed: Array<{ id: string; message: string }> = []
      for (const id of new Set<string>(req.body.registration_ids)) {
        try {
          await confirmRegistration(req.user!.id, req.params.id!, id, ctx) // audited and emailed one by one
          confirmed += 1
        } catch (err) {
          failed.push({ id, message: err instanceof Error ? err.message : 'Could not confirm.' })
        }
      }
      res.json({ confirmed, failed })
    } catch (err) {
      next(err)
    }
  },
)

// ------------------------------------------------------------------ Signed QR image used by the confirmation email
receiptsRouter.get('/:id/registrations/:registrationId/ticket-qr.png', async (req, res, next) => {
  try {
    const token = await qrTokenForSignedLink(req.params.id!, req.params.registrationId!, req.query.expires, req.query.sig)
    const buffer = await QRCode.toBuffer(`${env.APP_URL}/checkin/${token}`, { type: 'png', width: 320, margin: 2 })
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})
