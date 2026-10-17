import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../../worker.js'
import { registerTravelRoutes } from './travel-routes.js'

function testApp() {
  const objects = new Map<string, string>()
  const rooms = {
    idFromName: (id: string) => id,
    get: () => ({
      fetch: async (request: Request) => {
        const { tool, params } = (await request.json()) as {
          tool: string
          params: { collection: string; recordId: string; data?: Record<string, unknown> }
        }
        const key = `${params.collection}/${params.recordId}`
        const previous = objects.get(key)
        if (tool === 'records.get') {
          return previous
            ? Response.json({
                success: true,
                data: { record: { recordId: params.recordId, data: JSON.parse(previous) } },
              })
            : Response.json({ success: false, error: 'Record not found.' })
        }
        if (tool === 'records.create' && previous) {
          return Response.json({ success: false, error: 'Record already exists.' })
        }
        if (tool === 'records.create' || tool === 'records.update') {
          objects.set(key, JSON.stringify(params.data))
          return Response.json({ success: true, data: { recordId: params.recordId } })
        }
        return Response.json({ success: false, error: `Unknown tool: ${tool}` })
      },
    }),
  }
  const env = {
    AUTH0_DOMAIN: 'tenant.example.auth0.com',
    AUTH0_CLIENT_ID: 'client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
    AUTH0_SESSION_SECRET: 'a-test-session-secret-that-is-long-enough',
    DEEPSPACE_APP_ID: 'app_test',
    OWNER_USER_ID: 'owner',
    RECORD_ROOMS: rooms,
  } as unknown as Env
  const app = new Hono<{ Bindings: Env }>()
  registerTravelRoutes(app)

  return {
    objects,
    request: (path: string, init?: RequestInit) => app.request(path, init, env),
  }
}

function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers
    .get('set-cookie')
    ?.split(/,\s*(?=[^;,]+=)/u)
    .find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name} cookie`)
  return cookie.split(';', 1)[0]
}

describe('Auth0 travel routes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects cross-origin OTP requests before contacting Auth0', async () => {
    const { request } = testApp()
    const auth0Fetch = vi.fn()
    vi.stubGlobal('fetch', auth0Fetch)

    const response = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Member', email: 'member@example.com' }),
    })

    expect(response.status).toBe(401)
    expect(auth0Fetch).not.toHaveBeenCalled()
  })

  it('verifies an OTP, issues an HttpOnly session, and saves user/family JSON', async () => {
    const { objects, request } = testApp()
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|member-1',
          email: 'member@example.com',
          email_verified: true,
        }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const start = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Member', email: 'member@example.com' }),
    })
    expect(start.status).toBe(200)
    expect(auth0Fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        client_id: 'client-id',
        client_secret: 'test-client-secret',
        connection: 'email',
        email: 'member@example.com',
        send: 'code',
      }),
    })
    const pendingCookie = cookieFrom(start, 'travel_pending')

    const verify = await request('/auth/verify', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: pendingCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'member@example.com', code: '1234' }),
    })
    expect(verify.status).toBe(200)
    const tokenRequest = auth0Fetch.mock.calls[1]?.[1] as RequestInit | undefined
    expect(tokenRequest?.body).toBeInstanceOf(URLSearchParams)
    expect((tokenRequest?.body as URLSearchParams).get('client_secret')).toBe('test-client-secret')
    expect(await verify.json()).toEqual({
      userId: 'auth0|member-1',
      name: 'Member',
      email: 'member@example.com',
    })
    const sessionCookie = cookieFrom(verify, 'travel_session')
    expect(verify.headers.get('set-cookie')).toContain('HttpOnly')

    const me = await request('/auth/me', { headers: { Cookie: sessionCookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      user: { userId: 'auth0|member-1', name: 'Member', email: 'member@example.com' },
    })

    const create = await request('/families', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'Japan',
        startDate: '10/20/2026, 9:00 AM',
        endDate: '10/25/2026, 5:00 PM',
      }),
    })
    expect(create.status).toBe(200)
    const { family_code: familyCode } = (await create.json()) as { family_code: string }
    expect(familyCode).toMatch(/^\d{4}$/u)
    expect(objects.has('travel-users/auth0|member-1')).toBe(true)
    expect(objects.has(`travel-families/${familyCode}`)).toBe(true)

    const travelProfile = { budgetTier: { value: 'moderate', priority: 'critical' } }
    const profilePath = `/families/${familyCode}/members/auth0%7Cmember-1/travel-profile`
    const savePreferences = await request(profilePath, {
      method: 'PUT',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userTravelProfile: travelProfile }),
    })
    expect(savePreferences.status).toBe(200)
    const readPreferences = await request(profilePath, { headers: { Cookie: sessionCookie } })
    expect(await readPreferences.json()).toEqual({ userTravelProfile: travelProfile })
    expect(readPreferences.headers.get('Cache-Control')).toBe('no-store')

    const userFamilies = await request('/users/auth0%7Cmember-1/families', {
      headers: { Cookie: sessionCookie },
    })
    expect(userFamilies.status).toBe(200)
    expect(await userFamilies.json()).toMatchObject([
      { family_code: familyCode, country: 'Japan' },
    ])
  })

  it('rejects an invalid Auth0 OTP instead of creating a session', async () => {
    const { request } = testApp()
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({ error: 'invalid_grant', error_description: 'Wrong code' }, { status: 403 }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const start = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Member', email: 'member@example.com' }),
    })
    const verify = await request('/auth/verify', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookieFrom(start, 'travel_pending'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'member@example.com', code: '1234' }),
    })

    expect(verify.status).toBe(401)
    expect(await verify.json()).toEqual({ error: 'That code is incorrect or expired.' })
  })
})
