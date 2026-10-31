import { randomUUID } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/withTransaction.js'
import { env } from '../../config/env.js'
import { insertAuditLog, type AuditContext } from '../../utils/audit.js'
import { queueEmail, renderTemplate } from '../../utils/email.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js'
import { getEmailQuota } from '../bulkEmail/service.js'
import { buildResults, type QuestionKind, type ResultAnswer, type ResultQuestion, type ResultResponse } from './results.js'
import type { SaveSurveyInput, SubmitResponseInput } from './validation.js'

// The standard questions every survey starts with. Their position leaves room
// for the convenor's own questions (100+) before the closing comments box.
export const BUILTIN_QUESTIONS: Array<{ key: string; kind: QuestionKind; prompt: string; position: number; is_required: boolean }> = [
  { key: 'overall', kind: 'rating', prompt: 'Overall, how would you rate the conference?', position: 1, is_required: true },
  { key: 'organisation', kind: 'rating', prompt: 'How well was the conference organised?', position: 2, is_required: false },
  { key: 'venue', kind: 'rating', prompt: 'How would you rate the venue?', position: 3, is_required: false },
  { key: 'sessions', kind: 'rating', prompt: 'How would you rate the sessions overall?', position: 4, is_required: false },
  { key: 'best_session', kind: 'session', prompt: 'Which session did you enjoy most?', position: 5, is_required: false },
  { key: 'comments', kind: 'text', prompt: 'Any other comments or suggestions?', position: 1000, is_required: false },
]
const CUSTOM_POSITION_START = 100

// Who may answer: anyone checked in to the conference, any session chair, and
// any linked author/presenter of a paper on the (non-cancelled) programme.
const ELIGIBLE_SQL = `
  SELECT ca.user_id FROM conference_attendance ca WHERE ca.conference_id = ?
  UNION
  SELECT sc.user_id FROM session_chairs sc JOIN conference_sessions s ON s.id = sc.session_id
   WHERE s.conference_id = ? AND s.status <> 'cancelled'
  UNION
  SELECT sa.user_id FROM submission_authors sa JOIN presentations p ON p.submission_id = sa.submission_id
   WHERE p.conference_id = ? AND p.status <> 'cancelled' AND sa.user_id IS NOT NULL
  UNION
  SELECT p.presenter_user_id FROM presentations p
   WHERE p.conference_id = ? AND p.status <> 'cancelled' AND p.presenter_user_id IS NOT NULL`
const eligibleParams = (conferenceId: string) => [conferenceId, conferenceId, conferenceId, conferenceId]

const PUBLIC_SESSION_STATUSES = ['published', 'ongoing', 'completed']

type SurveyRow = {
  id: string
  conference_id: string
  title: string
  intro: string | null
  is_open: number | boolean
  opens_at: Date | null
  closes_at: Date | null
  allow_anonymous: number | boolean
  created_at: Date
  updated_at: Date
}

type QuestionRow = {
  id: string
  position: number
  builtin_key: string | null
  kind: QuestionKind
  prompt: string
  options: string[] | string
  is_required: number | boolean
}

type ConferenceRow = { id: string; name: string; slug: string; code: string; timezone: string; end_date: string }

export type SurveyDto = {
  id: string
  title: string
  intro: string | null
  is_open: boolean
  opens_at: string | null
  closes_at: string | null
  allow_anonymous: boolean
  accepting_responses: boolean
}

export type QuestionDto = {
  id: string
  position: number
  builtin_key: string | null
  kind: QuestionKind
  prompt: string
  options: string[]
  is_required: boolean
}

function toSurveyDto(row: SurveyRow, now = new Date()): SurveyDto {
  return {
    id: row.id,
    title: row.title,
    intro: row.intro,
    is_open: Boolean(row.is_open),
    opens_at: row.opens_at ? row.opens_at.toISOString() : null,
    closes_at: row.closes_at ? row.closes_at.toISOString() : null,
    allow_anonymous: Boolean(row.allow_anonymous),
    accepting_responses: isAccepting(row, now),
  }
}

/** Switched on AND inside its opens_at..closes_at window. */
export function isAccepting(row: Pick<SurveyRow, 'is_open' | 'opens_at' | 'closes_at'>, now = new Date()): boolean {
  return Boolean(row.is_open) && !!row.opens_at && !!row.closes_at && row.opens_at <= now && now < row.closes_at
}

function toQuestionDto(row: QuestionRow): QuestionDto {
  return {
    id: row.id,
    position: row.position,
    builtin_key: row.builtin_key,
    kind: row.kind,
    prompt: row.prompt,
    options: typeof row.options === 'string' ? (JSON.parse(row.options) as string[]) : row.options,
    is_required: Boolean(row.is_required),
  }
}

/** YYYY-MM-DD "today" in the conference's own timezone, comparable with its DATE columns. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

type Queryable = Pick<PoolConnection, 'query'>

async function loadConference(queryable: Queryable, conferenceId: string): Promise<ConferenceRow> {
  const [rows] = await queryable.query(
    'SELECT id, name, slug, code, timezone, end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [conferenceId],
  )
  const row = (rows as ConferenceRow[])[0]
  if (!row) throw new NotFoundError('This conference does not exist.')
  return row
}

async function loadSurvey(queryable: Queryable, conferenceId: string, forUpdate = false): Promise<SurveyRow | null> {
  const [rows] = await queryable.query(`SELECT * FROM feedback_surveys WHERE conference_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [
    conferenceId,
  ])
  return (rows as SurveyRow[])[0] ?? null
}

async function loadQuestions(queryable: Queryable, surveyId: string): Promise<QuestionDto[]> {
  const [rows] = await queryable.query(
    'SELECT id, position, builtin_key, kind, prompt, options, is_required FROM feedback_questions WHERE survey_id = ? ORDER BY position, created_at',
    [surveyId],
  )
  return (rows as QuestionRow[]).map(toQuestionDto)
}

async function countOne(queryable: Queryable, sql: string, params: unknown[]): Promise<number> {
  const [rows] = await queryable.query(sql, params)
  return Number((rows as Array<{ c: number }>)[0]?.c ?? 0)
}

export async function isEligible(conferenceId: string, userId: string): Promise<boolean> {
  const [rows] = await pool.query(`SELECT 1 FROM (${ELIGIBLE_SQL}) e WHERE e.user_id = ? LIMIT 1`, [...eligibleParams(conferenceId), userId])
  return (rows as unknown[]).length > 0
}

// -----------------------------------------------------------------------
// Convenor: build, open/close, invite
// -----------------------------------------------------------------------

export async function getSurveyAdmin(conferenceId: string) {
  const conference = await loadConference(pool, conferenceId)
  const survey = await loadSurvey(pool, conferenceId)
  const questions = survey ? await loadQuestions(pool, survey.id) : []
  const eligible = await countOne(pool, `SELECT COUNT(*) AS c FROM (${ELIGIBLE_SQL}) e`, eligibleParams(conferenceId))
  const invited = survey ? await countOne(pool, 'SELECT COUNT(*) AS c FROM feedback_invitations WHERE survey_id = ?', [survey.id]) : 0
  const responses = survey ? await countOne(pool, 'SELECT COUNT(*) AS c FROM feedback_responses WHERE survey_id = ?', [survey.id]) : 0
  const notInvited = survey ? await countPendingInvites(pool, conferenceId, survey.id) : eligible
  const quota = await getEmailQuota(pool)
  return {
    survey: survey ? toSurveyDto(survey) : null,
    questions,
    builtin_questions: BUILTIN_QUESTIONS.map(({ key, kind, prompt, is_required }) => ({ key, kind, prompt, is_required })),
    stats: { eligible, invited, responses, not_invited: notInvited },
    quota,
    conference: { end_date: conference.end_date, has_ended: todayInZone(conference.timezone) >= conference.end_date },
  }
}

function sameCustomQuestions(existing: QuestionDto[], next: SaveSurveyInput['custom_questions']): boolean {
  const a = existing.filter((q) => q.builtin_key === null).map((q) => [q.kind, q.prompt, q.options, q.is_required])
  const b = next.map((q) => [q.kind, q.prompt, q.options, q.is_required])
  return JSON.stringify(a) === JSON.stringify(b)
}

async function insertCustomQuestions(conn: PoolConnection, surveyId: string, questions: SaveSurveyInput['custom_questions']): Promise<void> {
  for (const [i, q] of questions.entries()) {
    await conn.query(
      'INSERT INTO feedback_questions (id, survey_id, position, builtin_key, kind, prompt, options, is_required) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
      [randomUUID(), surveyId, CUSTOM_POSITION_START + i, q.kind, q.prompt, JSON.stringify(q.options), q.is_required],
    )
  }
}

export async function saveSurvey(userId: string, conferenceId: string, input: SaveSurveyInput, ctx: AuditContext) {
  await loadConference(pool, conferenceId)
  const opensAt = input.opens_at ? new Date(input.opens_at) : null
  const closesAt = input.closes_at ? new Date(input.closes_at) : null

  await withTransaction(userId, async (conn) => {
    const existing = await loadSurvey(conn, conferenceId, true)
    if (!existing) {
      const surveyId = randomUUID()
      await conn.query(
        `INSERT INTO feedback_surveys (id, conference_id, title, intro, opens_at, closes_at, allow_anonymous, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [surveyId, conferenceId, input.title, input.intro, opensAt, closesAt, input.allow_anonymous, userId],
      )
      for (const q of BUILTIN_QUESTIONS) {
        await conn.query(
          'INSERT INTO feedback_questions (id, survey_id, position, builtin_key, kind, prompt, options, is_required) VALUES (?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?)',
          [randomUUID(), surveyId, q.position, q.key, q.kind, q.prompt, q.is_required],
        )
      }
      await insertCustomQuestions(conn, surveyId, input.custom_questions)
      await insertAuditLog(conn, {
        actorUserId: userId,
        conferenceId,
        action: 'feedback.survey_create',
        entityType: 'feedback_surveys',
        entityId: surveyId,
        newValues: input,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      return
    }

    if (existing.is_open && (!opensAt || !closesAt)) {
      throw new BadRequestError('An open survey needs both an opening and a closing date. Close it first to clear them.')
    }
    const questions = await loadQuestions(conn, existing.id)
    if (!sameCustomQuestions(questions, input.custom_questions)) {
      const responses = await countOne(conn, 'SELECT COUNT(*) AS c FROM feedback_responses WHERE survey_id = ?', [existing.id])
      if (responses > 0) {
        throw new ConflictError(
          "People have already answered, so the questions can't change any more. You can still edit the title, introduction, dates and anonymity.",
        )
      }
      await conn.query('DELETE FROM feedback_questions WHERE survey_id = ? AND builtin_key IS NULL', [existing.id])
      await insertCustomQuestions(conn, existing.id, input.custom_questions)
    }
    await conn.query('UPDATE feedback_surveys SET title = ?, intro = ?, opens_at = ?, closes_at = ?, allow_anonymous = ? WHERE id = ?', [
      input.title,
      input.intro,
      opensAt,
      closesAt,
      input.allow_anonymous,
      existing.id,
    ])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'feedback.survey_update',
      entityType: 'feedback_surveys',
      entityId: existing.id,
      oldValues: { ...toSurveyDto(existing), custom_questions: questions.filter((q) => q.builtin_key === null) },
      newValues: input,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
  return getSurveyAdmin(conferenceId)
}

export async function setSurveyOpen(userId: string, conferenceId: string, isOpen: boolean, ctx: AuditContext) {
  await withTransaction(userId, async (conn) => {
    const survey = await loadSurvey(conn, conferenceId, true)
    if (!survey) throw new NotFoundError('Create the survey first.')
    if (isOpen && (!survey.opens_at || !survey.closes_at)) {
      throw new BadRequestError('Set the opening and closing dates before opening the survey.')
    }
    if (Boolean(survey.is_open) === isOpen) return
    await conn.query('UPDATE feedback_surveys SET is_open = ? WHERE id = ?', [isOpen, survey.id])
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: isOpen ? 'feedback.survey_open' : 'feedback.survey_close',
      entityType: 'feedback_surveys',
      entityId: survey.id,
      oldValues: { is_open: Boolean(survey.is_open) },
      newValues: { is_open: isOpen },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })
  return getSurveyAdmin(conferenceId)
}

const PENDING_INVITES_FROM = `
  FROM users u
  WHERE u.id IN (SELECT e.user_id FROM (${ELIGIBLE_SQL}) e)
    AND u.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM feedback_invitations fi WHERE fi.survey_id = ? AND fi.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM feedback_responses fr WHERE fr.survey_id = ? AND fr.user_id = u.id)`

async function countPendingInvites(queryable: Queryable, conferenceId: string, surveyId: string): Promise<number> {
  return countOne(queryable, `SELECT COUNT(*) AS c ${PENDING_INVITES_FROM}`, [...eligibleParams(conferenceId), surveyId, surveyId])
}

/**
 * Emails the survey link to every eligible person not yet invited (and who
 * hasn't already answered), never more than today's remaining Brevo quota —
 * whoever is left over is picked up by the next click, on a later day.
 */
export async function sendInvitations(userId: string, conferenceId: string, ctx: AuditContext) {
  const conference = await loadConference(pool, conferenceId)
  const survey = await loadSurvey(pool, conferenceId)
  if (!survey) throw new NotFoundError('Create the survey first.')
  if (!isAccepting(survey)) throw new BadRequestError('Invitations can only be sent while the survey is open (inside its dates).')
  if (todayInZone(conference.timezone) < conference.end_date) {
    throw new BadRequestError(`Invitations can be sent from the last day of the conference (${conference.end_date}).`)
  }
  const quota = await getEmailQuota(pool)
  if (quota.remainingToday <= 0) {
    throw new ConflictError(`Today's email limit (${quota.dailyLimit}) is used up. Try again tomorrow.`)
  }

  const [rows] = await pool.query(`SELECT u.id, u.email, u.full_name ${PENDING_INVITES_FROM} ORDER BY u.full_name, u.id LIMIT ?`, [
    ...eligibleParams(conferenceId),
    survey.id,
    survey.id,
    quota.remainingToday,
  ])
  const recipients = rows as Array<{ id: string; email: string; full_name: string }>

  const [templateRows] = await pool.query(
    `SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'feedback_invitation' LIMIT 1`,
  )
  const template = (templateRows as Array<{ subject: string }>)[0]
  const link = `${env.APP_URL}/portal/feedback?c=${conference.id}`
  const closesAt = formatLocal(survey.closes_at!, conference.timezone)

  let sent = 0
  await withTransaction(userId, async (conn) => {
    for (const r of recipients) {
      const [result] = await conn.query('INSERT IGNORE INTO feedback_invitations (id, survey_id, user_id) VALUES (?, ?, ?)', [
        randomUUID(),
        survey.id,
        r.id,
      ])
      if ((result as { affectedRows: number }).affectedRows !== 1) continue
      const data = { full_name: r.full_name, conference_name: conference.name, conference_code: conference.code, link, closes_at: closesAt }
      await queueEmail(conn, {
        userId: r.id,
        conferenceId,
        recipientEmail: r.email,
        templateKey: 'feedback_invitation',
        subject: template ? renderTemplate(template.subject, data) : `Feedback: ${conference.name}`,
        templateData: data,
        entityType: 'feedback_surveys',
        entityId: survey.id,
      })
      sent += 1
    }
    await insertAuditLog(conn, {
      actorUserId: userId,
      conferenceId,
      action: 'feedback.invite',
      entityType: 'feedback_surveys',
      entityId: survey.id,
      newValues: { sent },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  })

  return {
    sent,
    still_to_invite: await countPendingInvites(pool, conferenceId, survey.id),
    quota: await getEmailQuota(pool),
  }
}

// -----------------------------------------------------------------------
// Respondents
// -----------------------------------------------------------------------

/** Open surveys (inside their dates) the signed-in person is eligible to answer — the portal card and "Give feedback" list. */
export async function listMyFeedback(userId: string) {
  const [rows] = await pool.query(
    `SELECT fs.conference_id, c.name AS conference_name, c.slug AS conference_slug, fs.title, fs.closes_at,
            EXISTS(SELECT 1 FROM feedback_responses fr WHERE fr.survey_id = fs.id AND fr.user_id = ?) AS responded
     FROM feedback_surveys fs
     JOIN conferences c ON c.id = fs.conference_id AND c.deleted_at IS NULL
     WHERE fs.is_open = TRUE AND fs.opens_at <= NOW(3) AND fs.closes_at > NOW(3)
     ORDER BY fs.closes_at`,
    [userId],
  )
  const surveys = rows as Array<{
    conference_id: string
    conference_name: string
    conference_slug: string
    title: string
    closes_at: Date
    responded: number
  }>
  const mine = []
  for (const s of surveys) {
    if (!(await isEligible(s.conference_id, userId))) continue
    mine.push({ ...s, closes_at: s.closes_at.toISOString(), responded: Boolean(s.responded) })
  }
  return mine
}

async function loadPublicSessions(queryable: Queryable, conferenceId: string) {
  const [rows] = await queryable.query(
    `SELECT id, title, starts_at FROM conference_sessions WHERE conference_id = ? AND status IN (?) ORDER BY starts_at, title`,
    [conferenceId, PUBLIC_SESSION_STATUSES],
  )
  return (rows as Array<{ id: string; title: string; starts_at: Date }>).map((s) => ({ ...s, starts_at: s.starts_at.toISOString() }))
}

async function hasResponded(queryable: Queryable, surveyId: string, userId: string): Promise<boolean> {
  return (await countOne(queryable, 'SELECT COUNT(*) AS c FROM feedback_responses WHERE survey_id = ? AND user_id = ?', [surveyId, userId])) > 0
}

/** Shared gate for the form and submitting: the survey must be open, and the caller eligible. */
async function openSurveyFor(conferenceId: string, userId: string): Promise<SurveyRow> {
  const survey = await loadSurvey(pool, conferenceId)
  if (!survey || !isAccepting(survey)) throw new NotFoundError("This conference's feedback survey isn't open right now.")
  if (!(await isEligible(conferenceId, userId))) {
    throw new ForbiddenError('Only people who took part in the conference (checked in, chaired or presented) can give feedback.')
  }
  return survey
}

export async function getSurveyForm(conferenceId: string, userId: string) {
  const conference = await loadConference(pool, conferenceId)
  const survey = await openSurveyFor(conferenceId, userId)
  return {
    conference: { id: conference.id, name: conference.name },
    survey: toSurveyDto(survey),
    questions: await loadQuestions(pool, survey.id),
    sessions: await loadPublicSessions(pool, conferenceId),
    responded: await hasResponded(pool, survey.id, userId),
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ER_DUP_ENTRY')
}

export async function submitResponse(conferenceId: string, userId: string, input: SubmitResponseInput) {
  const survey = await openSurveyFor(conferenceId, userId)
  if (input.is_anonymous && !survey.allow_anonymous) throw new BadRequestError('This survey does not accept anonymous answers.')
  if (await hasResponded(pool, survey.id, userId)) throw new ConflictError('You have already given feedback for this conference. Thank you!')

  const questions = await loadQuestions(pool, survey.id)
  const questionById = new Map(questions.map((q) => [q.id, q]))
  const sessionIds = new Set((await loadPublicSessions(pool, conferenceId)).map((s) => s.id))
  const seen = new Set<string>()
  const rows: Array<Omit<ResultAnswer, 'response_id'>> = []
  const fields: Record<string, string> = {}

  for (const a of input.answers) {
    const q = questionById.get(a.question_id)
    if (!q) throw new BadRequestError('One of the answers is for a question that is not in this survey.')
    if (seen.has(q.id)) throw new BadRequestError('Each question can only be answered once.')
    seen.add(q.id)
    const row = { question_id: q.id, rating: null as number | null, text_value: null as string | null, choice_value: null as string | null, session_id: null as string | null }
    if (q.kind === 'rating' && a.rating != null) row.rating = a.rating
    if (q.kind === 'text' && a.text) row.text_value = a.text
    if (q.kind === 'choice' && a.choice) {
      if (!q.options.includes(a.choice)) fields[q.id] = 'Pick one of the listed options.'
      row.choice_value = a.choice
    }
    if (q.kind === 'session' && a.session_id) {
      if (!sessionIds.has(a.session_id)) fields[q.id] = 'Pick a session from the programme.'
      row.session_id = a.session_id
    }
    if (row.rating !== null || row.text_value !== null || row.choice_value !== null || row.session_id !== null) rows.push(row)
  }
  for (const q of questions) {
    if (q.is_required && !rows.some((r) => r.question_id === q.id)) fields[q.id] = 'Please answer this question.'
  }
  if (Object.keys(fields).length > 0) throw new BadRequestError('Some answers need attention.', fields)

  // No audit-log entry on purpose: the activity log is readable by the
  // convenor and would name who answered, breaking anonymity.
  try {
    await withTransaction(userId, async (conn) => {
      const responseId = randomUUID()
      await conn.query('INSERT INTO feedback_responses (id, survey_id, conference_id, user_id, is_anonymous) VALUES (?, ?, ?, ?, ?)', [
        responseId,
        survey.id,
        conferenceId,
        userId,
        input.is_anonymous,
      ])
      for (const r of rows) {
        await conn.query(
          'INSERT INTO feedback_answers (id, response_id, question_id, rating, text_value, choice_value, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), responseId, r.question_id, r.rating, r.text_value, r.choice_value, r.session_id],
        )
      }
    })
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new ConflictError('You have already given feedback for this conference. Thank you!')
    throw err
  }
  return { message: 'Thank you for your feedback!' }
}

// -----------------------------------------------------------------------
// Convenor: results
// -----------------------------------------------------------------------

async function loadResultsData(conferenceId: string) {
  const conference = await loadConference(pool, conferenceId)
  const survey = await loadSurvey(pool, conferenceId)
  if (!survey) throw new NotFoundError('There is no feedback survey for this conference yet.')
  const questions = await loadQuestions(pool, survey.id)
  // The name is blanked in SQL for anonymous responses, so it never leaves the database.
  const [responseRows] = await pool.query(
    `SELECT r.id, r.submitted_at, IF(r.is_anonymous, NULL, u.full_name) AS respondent_name
     FROM feedback_responses r JOIN users u ON u.id = r.user_id
     WHERE r.survey_id = ? ORDER BY r.submitted_at`,
    [survey.id],
  )
  const responses: ResultResponse[] = (responseRows as Array<{ id: string; submitted_at: Date; respondent_name: string | null }>).map((r) => ({
    ...r,
    submitted_at: r.submitted_at.toISOString(),
  }))
  const [answerRows] = await pool.query(
    `SELECT a.response_id, a.question_id, a.rating, a.text_value, a.choice_value, a.session_id
     FROM feedback_answers a JOIN feedback_responses r ON r.id = a.response_id WHERE r.survey_id = ?`,
    [survey.id],
  )
  const [sessionRows] = await pool.query('SELECT id, title FROM conference_sessions WHERE conference_id = ?', [conferenceId])
  const sessionTitles = new Map((sessionRows as Array<{ id: string; title: string }>).map((s) => [s.id, s.title]))
  return { conference, survey, questions, responses, answers: answerRows as ResultAnswer[], sessionTitles }
}

export async function getResults(conferenceId: string) {
  const { survey, questions, responses, answers, sessionTitles } = await loadResultsData(conferenceId)
  const eligible = await countOne(pool, `SELECT COUNT(*) AS c FROM (${ELIGIBLE_SQL}) e`, eligibleParams(conferenceId))
  const results = buildResults(questions as ResultQuestion[], responses, answers, sessionTitles)
  const overall = results.find((q) => q.builtin_key === 'overall')
  return {
    survey: toSurveyDto(survey),
    response_count: responses.length,
    eligible_count: eligible,
    overall_average: overall && overall.kind === 'rating' ? overall.average : null,
    questions: results,
  }
}

export async function getResultsForExport(conferenceId: string) {
  const data = await loadResultsData(conferenceId)
  return { ...data, results: buildResults(data.questions as ResultQuestion[], data.responses, data.answers, data.sessionTitles) }
}
