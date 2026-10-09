import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listReviewerTracks,
  removeMember,
  setMemberMaxReviewLoad,
  setReviewerTracks,
} from './service.js'
import {
  changeRoleSchema,
  inviteMemberSchema,
  listMembersQuerySchema,
  setMaxReviewLoadSchema,
  setReviewerTracksSchema,
} from './validation.js'

export const membersRouter = Router()
const PERM = 'members.manage'

membersRouter.get('/:id/members', requireConferencePermission(PERM), validateQuery(listMembersQuerySchema), async (req, res, next) => {
  try {
    res.json({ members: await listMembers(req.params.id!, req.query as never) })
  } catch (err) {
    next(err)
  }
})

membersRouter.post('/:id/members/invite', requireConferencePermission(PERM), validateBody(inviteMemberSchema), async (req, res, next) => {
  try {
    res.status(201).json(await inviteMember(req.user!.id, req.params.id!, req.body))
  } catch (err) {
    next(err)
  }
})

membersRouter.patch(
  '/:id/members/:membershipId/role',
  requireConferencePermission(PERM),
  validateBody(changeRoleSchema),
  async (req, res, next) => {
    try {
      await changeMemberRole(req.user!.id, req.params.id!, req.params.membershipId!, req.body)
      res.json({ message: 'Role changed.' })
    } catch (err) {
      next(err)
    }
  },
)

membersRouter.patch(
  '/:id/members/:membershipId/max-review-load',
  requireConferencePermission(PERM),
  validateBody(setMaxReviewLoadSchema),
  async (req, res, next) => {
    try {
      await setMemberMaxReviewLoad(req.user!.id, req.params.id!, req.params.membershipId!, req.body)
      res.json({ message: 'Saved.' })
    } catch (err) {
      next(err)
    }
  },
)

membersRouter.delete('/:id/members/:membershipId', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    await removeMember(req.user!.id, req.params.id!, req.params.membershipId!)
    res.json({ message: 'Member removed.' })
  } catch (err) {
    next(err)
  }
})

membersRouter.get('/:id/members/:userId/reviewer-tracks', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ track_ids: await listReviewerTracks(req.params.id!, req.params.userId!) })
  } catch (err) {
    next(err)
  }
})

membersRouter.put(
  '/:id/members/:userId/reviewer-tracks',
  requireConferencePermission(PERM),
  validateBody(setReviewerTracksSchema),
  async (req, res, next) => {
    try {
      await setReviewerTracks(req.user!.id, req.params.id!, req.params.userId!, req.body.track_ids)
      res.json({ message: 'Saved.' })
    } catch (err) {
      next(err)
    }
  },
)
