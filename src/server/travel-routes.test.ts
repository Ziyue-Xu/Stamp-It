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
            : Response.json({ success: false, error: 'Record not found.' }, { status: 404 })
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
    GEMINI_API_KEY: 'test-gemini-api-key',
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

  it('generates an itinerary from the stored family preferences for the creator', async () => {
    const { objects, request } = testApp()
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|creator',
          email: 'creator@example.com',
          email_verified: true,
        }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const start = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Creator', email: 'creator@example.com' }),
    })
    const verify = await request('/auth/verify', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookieFrom(start, 'travel_pending'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'creator@example.com', code: '1234' }),
    })
    const sessionCookie = cookieFrom(verify, 'travel_session')
    const create = await request('/families', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'Japan',
        startDate: '3/14/2027, 9:00 AM',
        endDate: '3/16/2027, 6:00 PM',
        arrivalCity: 'Tokyo',
        departureCity: 'Kyoto',
      }),
    })
    const { family_code: familyId } = (await create.json()) as { family_code: string }
    const travelProfile = { budgetTier: { value: 2, priority: 'critical' } }
    const savePreferences = await request(
      `/families/${familyId}/members/auth0%7Ccreator/travel-profile`,
      {
        method: 'PUT',
        headers: {
          Origin: 'http://localhost',
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userTravelProfile: travelProfile }),
      },
    )
    expect(savePreferences.status).toBe(200)
    const storedFamilyKey = `travel-families/${familyId}`
    const storedFamily = JSON.parse(objects.get(storedFamilyKey) ?? '{}') as {
      users: Array<Record<string, unknown>>
    }
    expect(Object.keys(storedFamily).sort()).toEqual([
      'country',
      'endCity',
      'endDate',
      'endTime',
      'familyCode',
      'startCity',
      'startDate',
      'startTime',
      'users',
    ])
    expect(storedFamily).toMatchObject({
      familyCode: familyId,
      startDate: '2027-03-14',
      endDate: '2027-03-16',
      startTime: '09:00',
      endTime: '18:00',
      startCity: 'Tokyo',
      endCity: 'Kyoto',
      users: [
        {
          userProfile: {
            userId: 'auth0|creator',
            name: 'Creator',
            email: 'creator@example.com',
          },
        },
      ],
    })
    expect(storedFamily.users[0]?.userProfile).not.toHaveProperty('organizer')
    expect(storedFamily.users[0]?.userProfile).not.toHaveProperty('emailVerified')
    expect(storedFamily.users[0]?.userProfile).not.toHaveProperty('avatar')
    expect(storedFamily.users[0]?.userTravelProfile).toHaveProperty('activityPopularity')
    storedFamily.users.push({
      userProfile: { userId: 'auth0|member', name: 'Member', email: 'member@example.com' },
      userTravelProfile: {
        attractionPopularity: { value: 0.2, priority: 'flexible' },
        dietaryRestrictions: { value: ['vegan'], priority: 'weak_link' },
      },
    })
    objects.set(storedFamilyKey, JSON.stringify(storedFamily))

    const itinerary = {
      trip_title: 'Tokyo and Kyoto',
      start_date: '2027-03-14',
      end_date: '2027-03-16',
      destinations: ['Tokyo', 'Kyoto'],
      days: [
        {
          day_number: 1,
          date: '2027-03-14',
          base_city: 'Tokyo',
          day_theme_or_summary: 'Arrival',
          timeline: [
            {
              id: 'd1-1',
              item_type: 'activity',
              title: 'Visit a shrine',
              start_time: '09:00',
              end_time: '10:00',
              duration_minutes: 60,
              location: { name: 'Meiji Shrine', address: 'Tokyo' },
              transit_details: null,
              notes_and_tips: [],
              estimated_cost: null,
            },
            {
              id: 'd1-2',
              item_type: 'lodging',
              title: 'Hotel stay',
              start_time: '15:00',
              end_time: '23:59',
              duration_minutes: null,
              location: { name: 'Tokyo Hotel', address: 'Tokyo' },
              transit_details: null,
              notes_and_tips: [],
              estimated_cost: null,
            },
          ],
        },
      ],
      warnings: [],
    }
    const geminiFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'gemini-interaction-1', status: 'in_progress' }))
      .mockResolvedValueOnce(
        Response.json({ id: 'gemini-interaction-1', status: 'in_progress' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'gemini-interaction-1',
          status: 'completed',
          steps: [
            {
              type: 'thought',
              summary: [{ type: 'text', text: 'Internal reasoning omitted' }],
            },
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(itinerary),
                },
              ],
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', geminiFetch)

    const nonCreator = await request(`/families/${familyId}/plan`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestedBy: 'auth0|someone-else' }),
    })
    expect(nonCreator.status).toBe(403)
    expect(await nonCreator.json()).toEqual({
      error: 'Only the trip creator can generate the plan.',
    })
    expect(geminiFetch).not.toHaveBeenCalled()
    const normalizedFamily = JSON.parse(objects.get(storedFamilyKey) ?? '{}') as {
      users: Array<{ userProfile: Record<string, unknown>; userTravelProfile: Record<string, unknown> }>
    }
    expect(Object.keys(normalizedFamily).sort()).toEqual([
      'country',
      'endCity',
      'endDate',
      'endTime',
      'familyCode',
      'startCity',
      'startDate',
      'startTime',
      'users',
    ])
    expect(normalizedFamily.users[1]?.userProfile).toEqual({
      userId: 'auth0|member',
      name: 'Member',
      email: 'member@example.com',
    })
    expect(normalizedFamily.users[1]?.userTravelProfile).not.toHaveProperty('attractionPopularity')
    expect(normalizedFamily.users[1]?.userTravelProfile).toHaveProperty('activityPopularity')

    const startResponse = await request(`/travel/families/${familyId}/plan`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestedBy: 'auth0|creator' }),
    })
    expect(startResponse.status).toBe(202)
    const { interactionToken } = (await startResponse.json()) as { interactionToken: string }
    expect(interactionToken).toBeTruthy()

    const invalidToken = await request(`/travel/families/${familyId}/plan/invalid-token`, {
      headers: { Cookie: sessionCookie },
    })
    expect(invalidToken.status).toBe(403)
    expect(geminiFetch).toHaveBeenCalledOnce()

    const pendingResponse = await request(
      `/travel/families/${familyId}/plan/${encodeURIComponent(interactionToken)}`,
      { headers: { Cookie: sessionCookie } },
    )
    expect(pendingResponse.status).toBe(202)
    expect(await pendingResponse.json()).toEqual({ status: 'in_progress' })

    const response = await request(
      `/travel/families/${familyId}/plan/${encodeURIComponent(interactionToken)}`,
      { headers: { Cookie: sessionCookie } },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(itinerary)
    expect(geminiFetch).toHaveBeenCalledTimes(3)
    expect(geminiFetch.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
    )
    const geminiRequest = geminiFetch.mock.calls[0]?.[1] as RequestInit | undefined
    expect(geminiRequest?.headers).toMatchObject({
      'x-goog-api-key': 'test-gemini-api-key',
      'Api-Revision': '2026-05-20',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(geminiRequest?.body))).toMatchObject({
      model: 'gemini-3.8-flash',
      tools: [{ type: 'google_maps' }],
      background: true,
      store: true,
    })
    expect(geminiFetch.mock.calls[1]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions/gemini-interaction-1',
    )
    expect(geminiFetch.mock.calls[2]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions/gemini-interaction-1',
    )
    const input = JSON.parse(String(geminiRequest?.body)).input as string
    expect(input).toContain('"country":"Japan"')
    expect(input).toContain('"startDate":"2027-03-14"')
    expect(input).toContain('"endDate":"2027-03-16"')
    expect(input).toContain('"startTime":"09:00"')
    expect(input).toContain('"endTime":"18:00"')
    expect(input).toContain('"startCity":"Tokyo"')
    expect(input).toContain('"endCity":"Kyoto"')
    expect(input).not.toContain('"departureCity"')
    expect(input).toContain('"budgetTier":{"value":2,"priority":"critical"}')
    expect(input).toContain('"activityPopularity":{"value":[["Member (auth0|member)",0.2]],"priority":"flexible"}')
    expect(input).toContain('"dietaryRestrictions":{"value":[["Member (auth0|member)",["vegan"]]],"priority":"weak_link"}')
  })

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
    const startRequest = auth0Fetch.mock.calls[0]?.[1] as RequestInit | undefined
    expect(startRequest).toMatchObject({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        client_id: 'client-id',
        connection: 'email',
        email: 'member@example.com',
        send: 'code',
      }),
    })
    expect(JSON.parse(String(startRequest?.body))).not.toHaveProperty('client_secret')
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
    expect((tokenRequest?.body as URLSearchParams).has('client_secret')).toBe(false)
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
        startDate: '2026-10-20',
        endDate: '2026-10-25',
        startTime: '09:00',
        endTime: '17:00',
        startCity: 'Tokyo',
        endCity: 'Osaka',
      }),
    })
    expect(create.status).toBe(200)
    const { family_code: familyCode } = (await create.json()) as { family_code: string }
    expect(familyCode).toMatch(/^\d{4}$/u)
    expect(objects.has('travel-users/auth0|member-1')).toBe(true)
    expect(objects.has(`travel-families/${familyCode}`)).toBe(true)
    expect(JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}')).toMatchObject({
      familyCode,
      startDate: '2026-10-20',
      endDate: '2026-10-25',
      startTime: '09:00',
      endTime: '17:00',
      startCity: 'Tokyo',
      endCity: 'Osaka',
    })
    expect(JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}')).not.toHaveProperty('ownerId')

    const updateProfile = await request('/users/auth0%7Cmember-1', {
      method: 'PATCH',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated Member', avatar: 'fuji' }),
    })
    expect(updateProfile.status).toBe(200)
    expect(JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}').users[0].userProfile)
      .toEqual({ userId: 'auth0|member-1', name: 'Updated Member', email: 'member@example.com' })
    expect(
      Object.keys(
        JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}').users[0].userTravelProfile,
      ),
    ).toContain('activityPopularity')
    expect(
      JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}').users[0].userTravelProfile,
    ).not.toHaveProperty('attractionPopularity')

    const travelProfile = {
      budgetTier: { value: 'moderate', priority: 'critical' },
      attractionPopularity: { value: 0.7, priority: 'flexible' },
    }
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
    expect(await readPreferences.json()).toMatchObject({
      userTravelProfile: {
        budgetTier: { value: 'moderate', priority: 'critical' },
        attractionPopularity: { value: 0.7, priority: 'flexible' },
      },
    })
    expect(readPreferences.headers.get('Cache-Control')).toBe('no-store')

    const userFamilies = await request('/users/auth0%7Cmember-1/families', {
      headers: { Cookie: sessionCookie },
    })
    expect(userFamilies.status).toBe(200)
    expect(await userFamilies.json()).toMatchObject([
      {
        family_code: familyCode,
        country: 'Japan',
        arrivalCity: 'Tokyo',
        departureCity: 'Osaka',
      },
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
