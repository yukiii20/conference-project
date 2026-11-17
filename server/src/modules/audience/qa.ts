import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { assertConferenceInSession } from '../../middleware/sessionScope.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { getConferencePermissions, isPlatformAdmin } from '../auth/service.js'
import { assertConfirmedRegistration, getAudienceSettings, plainText } from './access.js'

/** Q&A limits (the 300-character limit is also a CHECK in the table). */
export const QA_MAX_LENGTH = 300
export const QA_MAX_PER_SESSION = 5
/** Minimum gap between two questions from the same person, anywhere in the conference. */
export const QA_MIN_SECONDS_BETWEEN = 15

export const askQuestionSchema = z.object({
  body: z
    .string()
    .transform((v) => plainText(v))
    .pipe(
      z
        .string()
        .min(1, 'Type your question.')
        .max(QA_MAX_LENGTH, `Keep your question to ${QA_MAX_LENGTH} characters or fewer.`),
    ),
  is_anonymous: z.boolean().default(false),
  presentation_id: z.string().uuid().nullable().optional(),
})
export type AskQuestionInput = z.infer<typeof askQuestionSchema>

export const moderateQuestionSchema = z.object({ status: z.enum(['visible', 'answered', 'hidden']) })

export type QaSort = 'votes' | 'recent'
export function parseSort(value: unknown): QaSort {
  return value === 'recent' ? 'recent' : 'votes'
}

type SessionRow = { id: string; title: string; status: string; starts_at: string; ends_at: string }

async function loadSession(conferenceId: string, sessionId: string): Promise<SessionRow> {
  const [rows] = await pool.query(
    `SELECT id, title, status, starts_at, ends_at FROM conference_sessions WHERE id = ? AND conference_id = ? LIMIT 1`,
    [sessionId, conferenceId],
  )
  const session = (rows as SessionRow[])[0]
  if (!session || session.status === 'draft') throw new NotFoundError('This session does not exist.')
  return session
}

export type QaWindow = { opens_at: string; closes_at: string; open: boolean }

/** Q&A opens when the session starts and closes `minutesAfterEnd` after it ends (convenor setting, default 30). */
export function qaWindow(startsAt: string | Date, endsAt: string | Date, minutesAfterEnd: number, now = new Date()): QaWindow {
  const opens = new Date(startsAt)
  const closes = new Date(new Date(endsAt).getTime() + minutesAfterEnd * 60_000)
  return { opens_at: opens.toISOString(), closes_at: closes.toISOString(), open: now >= opens && now <= closes }
}

async function windowFor(conferenceId: string, session: SessionRow, now = new Date()): Promise<QaWindow> {
  const settings = await getAudienceSettings(conferenceId)
  return qaWindow(session.starts_at, session.ends_at, settings.qa_minutes_after_end, now)
}

function assertOpen(session: SessionRow, window: QaWindow, now = new Date()): void {
  if (session.status === 'cancelled') throw new ForbiddenError('This session has been cancelled.')
  if (window.open) return
  throw new ForbiddenError(
    now < new Date(window.opens_at) ? 'Questions open when the session starts.' : 'Questions for this session are closed.',
  )
}

export type AudienceQuestion = {
  id: string
  body: string
  /** null when the asker chose "ask anonymously". */
  author_name: string | null
  is_mine: boolean
  status: 'visible' | 'answered' | 'hidden'
  vote_count: number
  voted_by_me: boolean
  presentation_id: string | null
  created_at: string
}

function orderBy(sort: QaSort): string {
  return sort === 'recent' ? 'q.created_at DESC' : 'q.vote_count DESC, q.created_at ASC'
}

/**
 * What an Audience member sees for one session: visible + answered questions, plus their own
 * hidden ones (marked), never deleted ones. Anonymous askers show no name - to anyone.
 */
export async function listAudienceQuestions(
  conferenceId: string,
  sessionId: string,
  userId: string,
  sort: QaSort,
): Promise<{ session: { id: string; title: string }; window: QaWindow; my_count: number; limit: number; questions: AudienceQuestion[] }> {
  const session = await loadSession(conferenceId, sessionId)
  const window = await windowFor(conferenceId, session)
  const [rows] = await pool.query(
    `SELECT q.id, q.body, q.is_anonymous, q.user_id, q.status, q.vote_count, q.presentation_id, q.created_at, u.full_name,
            EXISTS (SELECT 1 FROM session_question_votes v WHERE v.question_id = q.id AND v.user_id = ?) AS voted_by_me
     FROM session_questions q JOIN users u ON u.id = q.user_id
     WHERE q.conference_id = ? AND q.session_id = ?
       AND (q.status IN ('visible', 'answered') OR (q.status = 'hidden' AND q.user_id = ?))
     ORDER BY ${orderBy(sort)}`,
    [userId, conferenceId, sessionId, userId],
  )
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM session_questions WHERE session_id = ? AND user_id = ?`,
    [sessionId, userId],
  )
  return {
    session: { id: session.id, title: session.title },
    window,
    my_count: Number((countRows as Array<{ n: number }>)[0]?.n ?? 0),
    limit: QA_MAX_PER_SESSION,
    questions: (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      body: r.body as string,
      author_name: r.is_anonymous ? null : (r.full_name as string),
      is_mine: r.user_id === userId,
      status: r.status as AudienceQuestion['status'],
      vote_count: Number(r.vote_count),
      voted_by_me: Boolean(r.voted_by_me),
      presentation_id: (r.presentation_id as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  }
}

export async function askQuestion(
  conferenceId: string,
  sessionId: string,
  userId: string,
  input: AskQuestionInput,
  now = new Date(),
): Promise<{ id: string }> {
  await assertConfirmedRegistration(conferenceId, userId)
  const session = await loadSession(conferenceId, sessionId)
  assertOpen(session, await windowFor(conferenceId, session, now), now)

  if (input.presentation_id) {
    const [p] = await pool.query('SELECT 1 FROM presentations WHERE id = ? AND session_id = ? LIMIT 1', [input.presentation_id, sessionId])
    if ((p as unknown[]).length === 0) throw new BadRequestError('Choose a talk from this session.', { presentation_id: 'Choose a talk from this session.' })
  }

  return withTransaction(userId, async (conn) => {
    // Serialise one person's questions so two quick taps can't both slip under the limits.
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId])
    const [countRows] = await conn.query('SELECT COUNT(*) AS n FROM session_questions WHERE session_id = ? AND user_id = ?', [
      sessionId,
      userId,
    ])
    if (Number((countRows as Array<{ n: number }>)[0]?.n ?? 0) >= QA_MAX_PER_SESSION) {
      throw new ConflictError(`You can ask up to ${QA_MAX_PER_SESSION} questions in one session.`)
    }
    const [recent] = await conn.query(
      `SELECT 1 FROM session_questions WHERE conference_id = ? AND user_id = ? AND created_at > ? LIMIT 1`,
      [conferenceId, userId, new Date(now.getTime() - QA_MIN_SECONDS_BETWEEN * 1000)],
    )
    if ((recent as unknown[]).length > 0) {
      throw new AppError(429, `Please wait ${QA_MIN_SECONDS_BETWEEN} seconds between questions.`)
    }
    const [idRows] = await conn.query('SELECT UUID() AS id')
    const id = (idRows as Array<{ id: string }>)[0]!.id
    await conn.query(
      `INSERT INTO session_questions (id, conference_id, session_id, presentation_id, user_id, body, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, conferenceId, sessionId, input.presentation_id ?? null, userId, input.body, input.is_anonymous],
    )
    return { id }
  })
}

type QuestionRow = { id: string; conference_id: string; session_id: string; user_id: string; status: string }

async function loadQuestion(conferenceId: string, questionId: string): Promise<QuestionRow> {
  const [rows] = await pool.query(
    `SELECT id, conference_id, session_id, user_id, status FROM session_questions WHERE id = ? AND conference_id = ? LIMIT 1`,
    [questionId, conferenceId],
  )
  const q = (rows as QuestionRow[])[0]
  if (!q || q.status === 'deleted') throw new NotFoundError('This question does not exist.')
  return q
}

/** One upvote per person per question (not on your own), only while Q&A is open. */
export async function setVote(conferenceId: string, questionId: string, userId: string, vote: boolean, now = new Date()): Promise<{ vote_count: number }> {
  await assertConfirmedRegistration(conferenceId, userId)
  const question = await loadQuestion(conferenceId, questionId)
  if (question.status === 'hidden') throw new NotFoundError('This question does not exist.')
  if (question.user_id === userId) throw new BadRequestError("You can't vote for your own question.")
  const session = await loadSession(conferenceId, question.session_id)
  assertOpen(session, await windowFor(conferenceId, session, now), now)

  return withTransaction(userId, async (conn) => {
    await conn.query('SELECT id FROM session_questions WHERE id = ? FOR UPDATE', [questionId])
    if (vote) {
      const [r] = await conn.query('INSERT IGNORE INTO session_question_votes (question_id, user_id) VALUES (?, ?)', [questionId, userId])
      if ((r as { affectedRows: number }).affectedRows > 0) {
        await conn.query('UPDATE session_questions SET vote_count = vote_count + 1 WHERE id = ?', [questionId])
      }
    } else {
      const [r] = await conn.query('DELETE FROM session_question_votes WHERE question_id = ? AND user_id = ?', [questionId, userId])
      if ((r as { affectedRows: number }).affectedRows > 0) {
        await conn.query('UPDATE session_questions SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = ?', [questionId])
      }
    }
    const [rows] = await conn.query('SELECT vote_count FROM session_questions WHERE id = ?', [questionId])
    return { vote_count: Number((rows as Array<{ vote_count: number }>)[0]!.vote_count) }
  })
}

// ------------------------------------------------------------------ Moderation

/** Chair/co-chair of this session, or audience.moderate (convenor, manager), or a platform admin. */
export async function assertCanModerate(userId: string, conferenceId: string, sessionId: string): Promise<void> {
  assertConferenceInSession(conferenceId)
  await loadSession(conferenceId, sessionId)
  if (await isPlatformAdmin(userId)) return
  const permissions = await getConferencePermissions(userId, conferenceId)
  if (permissions.has('audience.moderate')) return
  const [rows] = await pool.query('SELECT 1 FROM session_chairs WHERE session_id = ? AND user_id = ? LIMIT 1', [sessionId, userId])
  if ((rows as unknown[]).length > 0) return
  throw new ForbiddenError('Only the session chair or the organisers can moderate these questions.')
}

export type ModeratorQuestion = Omit<AudienceQuestion, 'is_mine' | 'voted_by_me'> & { moderated_at: string | null }

export async function listModeratorQuestions(
  conferenceId: string,
  sessionId: string,
  sort: QaSort,
  status?: 'visible' | 'answered' | 'hidden',
): Promise<{ session: { id: string; title: string; starts_at: string; ends_at: string }; window: QaWindow; questions: ModeratorQuestion[] }> {
  const session = await loadSession(conferenceId, sessionId)
  const window = await windowFor(conferenceId, session)
  const [rows] = await pool.query(
    `SELECT q.id, q.body, q.is_anonymous, q.status, q.vote_count, q.presentation_id, q.created_at, q.moderated_at, u.full_name
     FROM session_questions q JOIN users u ON u.id = q.user_id
     WHERE q.conference_id = ? AND q.session_id = ? AND q.status <> 'deleted' ${status ? 'AND q.status = ?' : ''}
     ORDER BY ${orderBy(sort)}`,
    status ? [conferenceId, sessionId, status] : [conferenceId, sessionId],
  )
  return {
    session: { id: session.id, title: session.title, starts_at: session.starts_at, ends_at: session.ends_at },
    window,
    questions: (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      body: r.body as string,
      // Anonymous stays anonymous for moderators too.
      author_name: r.is_anonymous ? null : (r.full_name as string),
      status: r.status as ModeratorQuestion['status'],
      vote_count: Number(r.vote_count),
      presentation_id: (r.presentation_id as string | null) ?? null,
      created_at: r.created_at as string,
      moderated_at: (r.moderated_at as string | null) ?? null,
    })),
  }
}

export async function moderateQuestion(
  actorUserId: string,
  conferenceId: string,
  sessionId: string,
  questionId: string,
  status: 'visible' | 'answered' | 'hidden' | 'deleted',
  ctx: AuditContext = {},
): Promise<void> {
  const question = await loadQuestion(conferenceId, questionId)
  if (question.session_id !== sessionId) throw new NotFoundError('This question does not exist.')
  if (question.status === status) return
  await withTransaction(actorUserId, async (conn) => {
    await conn.query(`UPDATE session_questions SET status = ?, moderated_by = ?, moderated_at = NOW(3) WHERE id = ?`, [
      status,
      actorUserId,
      questionId,
    ])
    await insertAuditLog(conn, {
      actorUserId,
      conferenceId,
      action: status === 'deleted' ? 'qa.question_deleted' : 'qa.question_moderated',
      entityType: 'session_questions',
      entityId: questionId,
      oldValues: { status: question.status },
      newValues: { status, session_id: sessionId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
}
