import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { listRoleRequestsQuerySchema, rejectRoleRequestSchema } from './validation.js'
import { approveRoleRequest, listRoleRequests, rejectRoleRequest } from './service.js'

export const conferenceRoleRequestsRouter = Router()
export const roleRequestsRouter = Router()

conferenceRoleRequestsRouter.get(
  '/:id/role-requests',
  requireAuth,
  validateQuery(listRoleRequestsQuerySchema),
  async (req, res, next) => {
    try {
      const { status } = req.query as unknown as { status?: string }
      const requests = await listRoleRequests(req.user!.id, req.params.id!, status)
      res.json({ requests })
    } catch (err) {
      next(err)
    }
  },
)

roleRequestsRouter.post('/:id/approve', requireAuth, async (req, res, next) => {
  try {
    await approveRoleRequest(req.user!.id, req.params.id!)
    res.json({ message: 'Request approved.' })
  } catch (err) {
    next(err)
  }
})

roleRequestsRouter.post('/:id/reject', requireAuth, validateBody(rejectRoleRequestSchema), async (req, res, next) => {
  try {
    await rejectRoleRequest(req.user!.id, req.params.id!, req.body.reason)
    res.json({ message: 'Request rejected.' })
  } catch (err) {
    next(err)
  }
})
