import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { suspendUser } from '../src/modules/admin/service.js'
import { createUser, makePlatformAdmin, resetDatabase } from './helpers.js'

const app = createApp()

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

async function loginAsAdmin(email: string) {
  const userId = await createUser({ email, password: 'Str0ng!Pass' })
  await makePlatformAdmin(userId)
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/admin-login').send({ email, password: 'Str0ng!Pass' })
  expect(login.status).toBe(200)
  return { agent, userId }
}

describe('admin cannot suspend themselves', () => {
  it('rejects suspending your own account over HTTP', async () => {
    const { agent, userId } = await loginAsAdmin('solo-admin@example.com')

    const res = await agent.post(`/api/admin/users/${userId}/suspend`)
    expect(res.status).toBe(400)

    const [rows] = await pool.query('SELECT status FROM users WHERE id = ?', [userId])
    expect((rows as Array<{ status: string }>)[0]!.status).toBe('active')
  })
})

describe('admin cannot suspend the last active admin', () => {
  // Through the real HTTP route this can never fire (the signed-in admin
  // performing the suspend is, by the self-check above, never the target —
  // which means that admin themself always counts as "another active admin"
  // and the count can never reach zero). It's still a real safety net for the
  // service function itself, which other code paths may call directly in the
  // future, so this test exercises suspendUser() at that layer.
  it('rejects a suspend that would leave zero active admins', async () => {
    const onlyAdminId = await createUser({ email: 'only-admin@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(onlyAdminId)
    const someoneElse = await createUser({ email: 'bystander@example.com', password: 'Str0ng!Pass' })

    await expect(suspendUser(someoneElse, onlyAdminId)).rejects.toThrow(/last active administrator/i)

    const [rows] = await pool.query('SELECT status FROM users WHERE id = ?', [onlyAdminId])
    expect((rows as Array<{ status: string }>)[0]!.status).toBe('active')
  })

  it('allows the suspend once another active admin exists', async () => {
    const adminAId = await createUser({ email: 'admin-a@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminAId)
    const adminBId = await createUser({ email: 'admin-b@example.com', password: 'Str0ng!Pass' })
    await makePlatformAdmin(adminBId)
    const someoneElse = await createUser({ email: 'bystander2@example.com', password: 'Str0ng!Pass' })

    await suspendUser(someoneElse, adminAId)

    const [rows] = await pool.query('SELECT status FROM users WHERE id = ?', [adminAId])
    expect((rows as Array<{ status: string }>)[0]!.status).toBe('suspended')
  })
})

describe('admin reactivate', () => {
  it('reactivates a suspended user', async () => {
    const { agent } = await loginAsAdmin('reactivator@example.com')
    const targetId = await createUser({ email: 'target@example.com', password: 'Str0ng!Pass' })

    const suspend = await agent.post(`/api/admin/users/${targetId}/suspend`)
    expect(suspend.status).toBe(200)

    const reactivate = await agent.post(`/api/admin/users/${targetId}/reactivate`)
    expect(reactivate.status).toBe(200)

    const [rows] = await pool.query('SELECT status FROM users WHERE id = ?', [targetId])
    expect((rows as Array<{ status: string }>)[0]!.status).toBe('active')
  })
})
