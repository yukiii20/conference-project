import prompts from 'prompts'
import { pool } from '../db/pool.js'
import { withTransaction } from '../db/withTransaction.js'
import { hashPassword } from '../modules/auth/service.js'

const PASSWORD_RULES: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'at least 8 characters', test: (p) => p.length >= 8 },
  { label: 'one uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'one lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'one number', test: (p) => /[0-9]/.test(p) },
  { label: 'one symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

function validatePassword(password: string): string | true {
  const failed = PASSWORD_RULES.filter((r) => !r.test(password))
  if (failed.length > 0) {
    return `Password needs ${failed.map((r) => r.label).join(', ')}.`
  }
  return true
}

async function main() {
  console.log('Create a platform administrator account.\n')

  const answers = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Email',
      validate: (value: string) => (/^\S+@\S+\.\S+$/.test(value) ? true : 'Enter a valid email address.'),
    },
    {
      type: 'text',
      name: 'full_name',
      message: 'Full name',
      validate: (value: string) => (value.trim().length >= 2 ? true : 'Full name must be at least 2 characters.'),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
      validate: validatePassword,
    },
  ])

  if (!answers.email || !answers.password || !answers.full_name) {
    console.log('\nCancelled.')
    process.exit(1)
  }

  const email = String(answers.email).trim().toLowerCase()

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  if ((existing as unknown[]).length > 0) {
    console.error(`\nAn account with email ${email} already exists.`)
    process.exit(1)
  }

  const passwordHash = await hashPassword(String(answers.password))

  await withTransaction(null, async (conn) => {
    await conn.query('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)', [
      email,
      passwordHash,
      String(answers.full_name).trim(),
    ])
    const [rows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    const userId = (rows as Array<{ id: string }>)[0]!.id
    await conn.query('INSERT INTO platform_user_roles (user_id, role_code) VALUES (?, ?)', [userId, 'admin'])
  })

  console.log(`\nAdministrator account created for ${email}.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFailed to create administrator account:', err)
  process.exit(1)
})
