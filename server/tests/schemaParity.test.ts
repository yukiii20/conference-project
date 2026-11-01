import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import * as client from '../../src/lib/validation'
import * as auth from '../src/modules/auth/validation.js'
import * as registration from '../src/modules/registration/validation.js'
import * as submissions from '../src/modules/submissions/validation.js'
import * as members from '../src/modules/members/validation.js'

/**
 * Audit M4: the browser re-implements some server Zod schemas so forms can show errors before
 * submitting. The server stays authoritative; this test only makes sure the two copies agree on
 * what is valid, so a user is never told "OK" by the form and then "invalid" by the server (or
 * blocked by the form for something the server would accept).
 *
 * Only schemas that receive the SAME representation on both sides are compared. (Prices and
 * payments are left out on purpose: the form validates datetime-local strings, the server ISO.)
 */
type Pair = {
  name: string
  client: ZodType
  server: ZodType
  samples: unknown[]
  /** The form may deliberately demand more than the API (never less): only "client accepts, server rejects" fails. */
  clientMayBeStricter?: boolean
}

const long = (n: number) => 'x'.repeat(n)

const PAIRS: Pair[] = [
  {
    name: 'full name',
    client: client.nameSchema,
    server: auth.nameSchema,
    samples: ['Sita Shrestha', 'A', '', '   ', ' Ram ', long(100), long(101), long(150), long(151), 'नेपाली नाम', 42, null],
  },
  {
    name: 'email',
    client: client.emailSchema,
    server: auth.emailSchema,
    samples: ['a@b.co', 'A@B.COM', ' padded@example.com ', 'no-at.example.com', 'a@b', '', `${long(250)}@x.io`, 'x@例え.jp', null],
  },
  {
    name: 'phone',
    client: client.phoneSchema,
    server: auth.phoneSchema,
    samples: ['9800000000', '+9779800000000', '980-000-0000', '98000', '', 'abc', '+1 (555) 010-0000', '0000000000', long(30), null],
  },
  {
    name: 'password',
    client: client.passwordSchema,
    server: auth.passwordSchema,
    samples: ['Str0ng!Pass', 'short1!', 'alllowercase123!', 'NoDigits!!', 'NoSymbol123', 'Str0ng!Pass'.repeat(20), '', '        ', null],
  },
  {
    name: 'login',
    client: client.loginSchema,
    server: auth.loginSchema,
    samples: [
      { email: 'a@b.co', password: 'x' },
      { email: 'a@b.co', password: '' },
      { email: 'bad', password: 'x' },
      { email: 'a@b.co' },
      {},
    ],
  },
  {
    name: 'forgot password',
    client: client.forgotPasswordSchema,
    server: auth.forgotPasswordSchema,
    samples: [{ email: 'a@b.co' }, { email: '' }, { email: 'nope' }, {}],
  },
  {
    name: 'registration category',
    client: client.registrationCategorySchema,
    server: registration.registrationCategorySchema,
    samples: [
      { code: 'student', name: 'Student' },
      { code: 'Student', name: 'Student' },
      { code: 's', name: 'Student' },
      { code: 'student-1', name: 'Student' },
      { code: 'early_bird_2026', name: 'Early', description: '', is_active: false, display_order: 3 },
      { code: 'student', name: '' },
      { code: 'student', name: long(101) },
      { code: 'student', name: 'Student', description: long(501) },
      { code: 'student', name: 'Student', display_order: '2' },
    ],
  },
  {
    name: 'keywords',
    // The abstract form asks for at least one keyword; the API also accepts keyword-less drafts.
    clientMayBeStricter: true,
    client: client.keywordsSchema,
    server: submissions.keywordsSchema,
    samples: [[], ['ai'], ['ai', 'ml', 'nlp', 'cv', 'robotics'], Array.from({ length: 11 }, (_, i) => `k${i}`), [''], [long(61)], ['dup', 'dup'], 'ai', null],
  },
  {
    name: 'invite member',
    client: client.inviteMemberSchema,
    server: members.inviteMemberSchema,
    samples: [
      { email: 'a@b.co', full_name: 'Sita', role_code: 'reviewer' },
      { email: 'a@b.co', full_name: 'Sita', role_code: 'convenor' },
      { email: 'a@b.co', full_name: 'Sita', role_code: 'wizard' },
      { email: 'bad', full_name: 'Sita', role_code: 'reviewer' },
      { email: 'a@b.co', full_name: '', role_code: 'reviewer' },
      { email: 'a@b.co', role_code: 'reviewer' },
    ],
  },
]

describe('client and server validation agree (audit M4)', () => {
  for (const pair of PAIRS) {
    it(pair.name, () => {
      const disagreements = pair.samples
        .map((sample) => ({ sample, client: pair.client.safeParse(sample).success, server: pair.server.safeParse(sample).success }))
        .filter((r) => (pair.clientMayBeStricter ? r.client && !r.server : r.client !== r.server))
      expect(disagreements, `client/server disagree for ${pair.name}`).toEqual([])
    })
  }
})
