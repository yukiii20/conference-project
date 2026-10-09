import { Router } from 'express'
import { requireConferencePermission } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import {
  addCommitteeMember,
  createCommittee,
  deleteCommittee,
  deleteCommitteeMember,
  listCommittees,
  lookupUserByEmail,
  reorderCommitteeMembers,
  reorderCommittees,
  updateCommittee,
  updateCommitteeMember,
} from './service.js'
import {
  createCommitteeMemberSchema,
  createCommitteeSchema,
  reorderCommitteeMembersSchema,
  reorderCommitteesSchema,
  updateCommitteeMemberSchema,
  updateCommitteeSchema,
} from './validation.js'

export const committeesRouter = Router()
const PERM = 'committee.manage'

committeesRouter.get('/:id/committees/user-lookup', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : ''
    res.json({ user: email ? await lookupUserByEmail(email) : null })
  } catch (err) {
    next(err)
  }
})

committeesRouter.get('/:id/committees', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    res.json({ committees: await listCommittees(req.params.id!) })
  } catch (err) {
    next(err)
  }
})

committeesRouter.post('/:id/committees', requireConferencePermission(PERM), validateBody(createCommitteeSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createCommittee(req.user!.id, req.params.id!, req.body))
  } catch (err) {
    next(err)
  }
})

committeesRouter.post(
  '/:id/committees/reorder',
  requireConferencePermission(PERM),
  validateBody(reorderCommitteesSchema),
  async (req, res, next) => {
    try {
      await reorderCommittees(req.user!.id, req.params.id!, req.body.committee_ids)
      res.json({ message: 'Committees reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

committeesRouter.patch(
  '/:id/committees/:committeeId',
  requireConferencePermission(PERM),
  validateBody(updateCommitteeSchema),
  async (req, res, next) => {
    try {
      await updateCommittee(req.user!.id, req.params.id!, req.params.committeeId!, req.body)
      res.json({ message: 'Committee updated.' })
    } catch (err) {
      next(err)
    }
  },
)

committeesRouter.delete('/:id/committees/:committeeId', requireConferencePermission(PERM), async (req, res, next) => {
  try {
    await deleteCommittee(req.user!.id, req.params.id!, req.params.committeeId!)
    res.json({ message: 'Committee deleted.' })
  } catch (err) {
    next(err)
  }
})

committeesRouter.post(
  '/:id/committees/:committeeId/members',
  requireConferencePermission(PERM),
  validateBody(createCommitteeMemberSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await addCommitteeMember(req.user!.id, req.params.id!, req.params.committeeId!, req.body))
    } catch (err) {
      next(err)
    }
  },
)

committeesRouter.post(
  '/:id/committees/:committeeId/members/reorder',
  requireConferencePermission(PERM),
  validateBody(reorderCommitteeMembersSchema),
  async (req, res, next) => {
    try {
      await reorderCommitteeMembers(req.user!.id, req.params.id!, req.params.committeeId!, req.body.member_ids)
      res.json({ message: 'Members reordered.' })
    } catch (err) {
      next(err)
    }
  },
)

committeesRouter.patch(
  '/:id/committees/:committeeId/members/:memberId',
  requireConferencePermission(PERM),
  validateBody(updateCommitteeMemberSchema),
  async (req, res, next) => {
    try {
      await updateCommitteeMember(req.user!.id, req.params.id!, req.params.committeeId!, req.params.memberId!, req.body)
      res.json({ message: 'Member updated.' })
    } catch (err) {
      next(err)
    }
  },
)

committeesRouter.delete(
  '/:id/committees/:committeeId/members/:memberId',
  requireConferencePermission(PERM),
  async (req, res, next) => {
    try {
      await deleteCommitteeMember(req.user!.id, req.params.id!, req.params.committeeId!, req.params.memberId!)
      res.json({ message: 'Member removed.' })
    } catch (err) {
      next(err)
    }
  },
)
