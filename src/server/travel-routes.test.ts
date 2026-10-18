import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { runJob } from '../jobs.js'
import type { Env } from '../../worker.js'
import { travelFamiliesSchema, travelPlansSchema } from '../schemas/travel-schema.js'
import { registerTravelRoutes } from './travel-routes.js'

function testApp() {
  const objects = new Map<string, string>()
  const jobs: Record<string, unknown>[] = []
  const rooms = {
    idFromName: (id: string) => id,
    get: () => ({
      fetch: async (request: Request) => {
        const { tool, params } = (await request.json()) as {
          tool: string
          params: {
            collection: string
            recordId: string
            data?: Record<string, unknown>
            where?: Record<string, unknown>
            limit?: number
          }
        }
        const key = `${params.collection}/${params.recordId}`
        const previous = objects.get(key)
        if (tool === 'records.query') {
          const matches = [...objects.entries()]
            .filter(([storedKey, storedValue]) => {
              if (!storedKey.startsWith(`${params.collection}/`)) return false
              const data = JSON.parse(storedValue) as Record<string, unknown>
              return Object.entries(params.where ?? {}).every(([field, value]) => data[field] === value)
            })
            .slice(0, params.limit ?? 100)
            .map(([storedKey, storedValue]) => ({
              recordId: storedKey.slice(params.collection.length + 1),
              data: JSON.parse(storedValue) as Record<string, unknown>,
            }))
          return Response.json({
            success: true,
            data: { records: matches, count: matches.length },
          })
        }
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
        if (tool === 'records.delete') {
          objects.delete(key)
          return Response.json({ success: true, data: { recordId: params.recordId } })
        }
        if (tool === 'records.create' || tool === 'records.update') {
          const existing =
            tool === 'records.update' && previous
              ? (JSON.parse(previous) as Record<string, unknown>)
              : {}
          objects.set(key, JSON.stringify({ ...existing, ...params.data }))
          return Response.json({ success: true, data: { recordId: params.recordId } })
        }
        return Response.json({ success: false, error: `Unknown tool: ${tool}` })
      },
    }),
  }
  const jobRooms = {
    idFromName: (id: string) => id,
    get: () => ({
      fetch: async (request: Request) => {
        jobs.push((await request.json()) as Record<string, unknown>)
        return Response.json({ job: { id: `job-${jobs.length}` } })
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
    JOB_ROOMS: jobRooms,
    GEMINI_API_KEY: 'test-gemini-api-key',
  } as unknown as Env
  const app = new Hono<{ Bindings: Env }>()
  registerTravelRoutes(app)

  return {
    objects,
    jobs,
    env,
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

async function signIn(
  request: (path: string, init?: RequestInit) => Response | Promise<Response>,
  name: string,
  email: string,
): Promise<string> {
  const start = await request('/auth/start', {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  const verify = await request('/auth/verify', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      Cookie: cookieFrom(start, 'travel_pending'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code: '1234' }),
  })
  return cookieFrom(verify, 'travel_session')
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
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'member-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|member',
          email: 'member@example.com',
          email_verified: true,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'outsider-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|outsider',
          email: 'outsider@example.com',
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
    const memberCookie = await signIn(request, 'Member', 'member@example.com')
    const outsiderCookie = await signIn(request, 'Outsider', 'outsider@example.com')
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

    const partialPreferenceUpdate = await request(
      `/families/${familyId}/members/auth0%7Ccreator/travel-profile`,
      {
        method: 'PUT',
        headers: {
          Origin: 'http://localhost',
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userTravelProfile: { tripPace: { value: 0.3, priority: 'flexible' } },
        }),
      },
    )
    expect(partialPreferenceUpdate.status).toBe(200)
    const preservedPreferences = JSON.parse(objects.get(storedFamilyKey) ?? '{}') as {
      users: Array<{
        userTravelProfile: Record<string, Record<string, unknown>>
      }>
    }
    expect(preservedPreferences.users[0]?.userTravelProfile.tripPace).toMatchObject({
      value: 0.3,
      priority: 'flexible',
    })
    expect(preservedPreferences.users[0]?.userTravelProfile.budgetTier).toMatchObject({
      value: 2,
      priority: 'critical',
    })
    expect(
      preservedPreferences.users[0]?.userTravelProfile.dietaryRestrictions,
    ).toMatchObject({ value: [], priority: 'weak_link' })

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
    expect(objects.get(`travel-plans/${familyId}`)).toBe(
      JSON.stringify({ familyCode: familyId, format: 'backend', plan: itinerary }),
    )
    for (const cookie of [sessionCookie, memberCookie]) {
      const savedPlan = await request(`/travel/families/${familyId}/plan`, {
        headers: { Cookie: cookie },
      })
      expect(savedPlan.status).toBe(200)
      expect(await savedPlan.json()).toEqual(itinerary)
    }
    const outsiderPlan = await request(`/travel/families/${familyId}/plan`, {
      headers: { Cookie: outsiderCookie },
    })
    expect(outsiderPlan.status).toBe(403)
    expect(await outsiderPlan.json()).toEqual({
      error: 'You are not a member of this family.',
    })
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

  it('logs in an existing travel user without changing their saved profile', async () => {
    const { objects, request } = testApp()
    objects.set(
      'travel-users/auth0|existing',
      JSON.stringify({
        userId: 'auth0|existing',
        name: 'Saved Name',
        email: 'existing@example.com',
        emailVerified: true,
        avatar: 'fuji',
        families: ['1234'],
      }),
    )
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|existing',
          email: 'existing@example.com',
          email_verified: true,
        }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const start = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'existing@example.com' }),
    })
    expect(start.status).toBe(200)
    const verify = await request('/auth/verify', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookieFrom(start, 'travel_pending'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '', email: 'existing@example.com', code: '1234' }),
    })

    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({
      userId: 'auth0|existing',
      name: 'Saved Name',
      email: 'existing@example.com',
    })
    expect(JSON.parse(objects.get('travel-users/auth0|existing') ?? '{}')).toMatchObject({
      name: 'Saved Name',
      avatar: 'fuji',
      families: ['1234'],
    })
    expect(verify.headers.get('set-cookie')).toContain('travel_session=')
  })

  it('does not create an app account through the login flow', async () => {
    const { objects, request } = testApp()
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|new-user',
          email: 'new@example.com',
          email_verified: true,
        }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const start = await request('/auth/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'new@example.com' }),
    })
    const verify = await request('/auth/verify', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookieFrom(start, 'travel_pending'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '', email: 'new@example.com', code: '1234' }),
    })

    expect(verify.status).toBe(403)
    expect(await verify.json()).toEqual({
      error: 'No existing Travel Together account was found for this email.',
    })
    expect(objects.has('travel-users/auth0|new-user')).toBe(false)
    expect(verify.headers.get('set-cookie')).not.toContain('travel_session=')
  })

  it('creates a trip when arrival and departure cities are omitted', async () => {
    expect(
      travelFamiliesSchema.columns
        .filter((column) => column.name === 'startCity' || column.name === 'endCity')
        .every((column) => column.required === false),
    ).toBe(true)

    const { objects, request } = testApp()
    const auth0Fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
      .mockResolvedValueOnce(
        Response.json({
          sub: 'auth0|creator',
          email: 'creator@example.com',
          email_verified: true,
        }),
      )
    vi.stubGlobal('fetch', auth0Fetch)

    const sessionCookie = await signIn(request, 'Creator', 'creator@example.com')
    const create = await request('/families', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-16',
      }),
    })

    expect(create.status).toBe(200)
    const { family_code: familyCode } = (await create.json()) as { family_code: string }
    expect(JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}')).toMatchObject({
      country: 'Japan',
      startCity: '',
      endCity: '',
    })
  })

  it('lets a member leave and removes their preferences from the family JSON', async () => {
    const { objects, request } = testApp()
    const familyCode = '4812'
    const creatorId = 'auth0|creator'
    const memberId = 'auth0|member'
    const users = [
      {
        userId: creatorId,
        name: 'Creator',
        email: 'creator@example.com',
        emailVerified: true,
        avatar: 'taj',
        families: [familyCode],
      },
      {
        userId: memberId,
        name: 'Member',
        email: 'member@example.com',
        emailVerified: true,
        avatar: 'fuji',
        families: [familyCode],
      },
    ]
    for (const user of users) objects.set(`travel-users/${user.userId}`, JSON.stringify(user))
    objects.set(
      `travel-families/${familyCode}`,
      JSON.stringify({
        familyCode,
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-16',
        startTime: '09:00',
        endTime: '18:00',
        startCity: '',
        endCity: '',
        users: [
          {
            userProfile: { userId: creatorId, name: 'Creator', email: 'creator@example.com' },
            userTravelProfile: { budgetTier: { value: 2, priority: 'critical' } },
          },
          {
            userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
            userTravelProfile: { dietaryRestrictions: { value: ['vegan'], priority: 'weak_link' } },
          },
        ],
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: memberId,
            email: 'member@example.com',
            email_verified: true,
          }),
        ),
    )
    const sessionCookie = await signIn(request, 'Member', 'member@example.com')

    const response = await request(`/families/${familyCode}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost', Cookie: sessionCookie },
    })

    expect(response.status).toBe(200)
    const family = JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}') as {
      users: Array<{ userProfile: { userId: string }; userTravelProfile: Record<string, unknown> }>
    }
    expect(family.users).toHaveLength(1)
    expect(family.users[0]?.userProfile.userId).toBe(creatorId)
    expect(family.users[0]?.userTravelProfile).toHaveProperty('budgetTier')
    expect(JSON.parse(objects.get(`travel-users/${memberId}`) ?? '{}').families).toEqual([])
  })

  it('deletes a trip and its saved plan for the creator, and removes all member references', async () => {
    const { objects, request } = testApp()
    const familyCode = '5724'
    const creatorId = 'auth0|creator'
    const memberId = 'auth0|member'
    for (const user of [
      {
        userId: creatorId,
        name: 'Creator',
        email: 'creator@example.com',
        emailVerified: true,
        avatar: 'taj',
        families: [familyCode],
      },
      {
        userId: memberId,
        name: 'Member',
        email: 'member@example.com',
        emailVerified: true,
        avatar: 'fuji',
        families: [familyCode, '1010'],
      },
    ]) {
      objects.set(`travel-users/${user.userId}`, JSON.stringify(user))
    }
    objects.set(
      `travel-families/${familyCode}`,
      JSON.stringify({
        familyCode,
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-16',
        startTime: '09:00',
        endTime: '18:00',
        startCity: '',
        endCity: '',
        users: [
          {
            userProfile: { userId: creatorId, name: 'Creator', email: 'creator@example.com' },
            userTravelProfile: {},
          },
          {
            userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
            userTravelProfile: { tripPace: { value: 0.4, priority: 'flexible' } },
          },
        ],
      }),
    )
    objects.set(
      `travel-plans/${familyCode}`,
      JSON.stringify({ familyCode, format: 'backend', plan: { trip_title: 'Saved plan' } }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: creatorId,
            email: 'creator@example.com',
            email_verified: true,
          }),
        ),
    )
    const sessionCookie = await signIn(request, 'Creator', 'creator@example.com')

    const response = await request(`/families/${familyCode}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost', Cookie: sessionCookie },
    })

    expect(response.status).toBe(200)
    expect(objects.has(`travel-families/${familyCode}`)).toBe(false)
    expect(objects.has(`travel-plans/${familyCode}`)).toBe(false)
    expect(JSON.parse(objects.get(`travel-users/${creatorId}`) ?? '{}').families).toEqual([])
    expect(JSON.parse(objects.get(`travel-users/${memberId}`) ?? '{}').families).toEqual(['1010'])
  })

  it('stores edited itinerary JSON for trip members and serves it back to the UI', async () => {
    expect(travelPlansSchema.columns).toContainEqual({
      name: 'format',
      storage: 'text',
      interpretation: 'plain',
      required: false,
    })

    const { objects, request } = testApp()
    const familyCode = '6347'
    const memberId = 'auth0|member'
    objects.set(
      `travel-users/${memberId}`,
      JSON.stringify({
        userId: memberId,
        name: 'Member',
        email: 'member@example.com',
        emailVerified: true,
        avatar: 'taj',
        families: [familyCode],
      }),
    )
    objects.set(
      `travel-families/${familyCode}`,
      JSON.stringify({
        familyCode,
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-16',
        startTime: '09:00',
        endTime: '18:00',
        startCity: '',
        endCity: '',
        users: [
          {
            userProfile: { userId: 'auth0|creator', name: 'Creator', email: 'creator@example.com' },
            userTravelProfile: {},
          },
          {
            userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
            userTravelProfile: {},
          },
        ],
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: memberId,
            email: 'member@example.com',
            email_verified: true,
          }),
        ),
    )
    const sessionCookie = await signIn(request, 'Member', 'member@example.com')
    const editedPlan = {
      title: 'Japan plans',
      subtitle: 'Tokyo',
      startDate: '2027-03-14',
      endDate: '2027-03-16',
      days: [
        {
          dayNumber: 1,
          date: '2027-03-14',
          city: 'Tokyo',
          theme: 'Arrival',
          items: [{ id: 'stop-1', type: 'activity', title: 'Visit a shrine' }],
        },
      ],
    }

    const saveResponse = await request(`/families/${familyCode}/plan`, {
      method: 'PUT',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ updatedBy: memberId, plan: editedPlan }),
    })
    const readResponse = await request(`/families/${familyCode}/plan`, {
      headers: { Cookie: sessionCookie },
    })

    expect(saveResponse.status).toBe(200)
    expect(objects.get(`travel-plans/${familyCode}`)).toBe(
      JSON.stringify({ familyCode, format: 'travel-app', plan: editedPlan }),
    )
    expect(readResponse.status).toBe(200)
    expect(await readResponse.json()).toEqual({ format: 'travel-app', plan: editedPlan })
  })

  it('generates and persists a split in the shared itinerary for a trip member', async () => {
    const { objects, request } = testApp()
    const familyCode = '2468'
    const memberId = 'auth0|member'
    objects.set(
      `travel-families/${familyCode}`,
      JSON.stringify({
        familyCode,
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-14',
        startTime: '09:00',
        endTime: '18:00',
        startCity: 'Tokyo',
        endCity: 'Tokyo',
        users: [
          {
            userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
            userTravelProfile: {},
          },
          {
            userProfile: { userId: 'auth0|friend', name: 'Friend', email: 'friend@example.com' },
            userTravelProfile: {},
          },
        ],
      }),
    )
    const sourceActivity = {
      id: 'stop-1',
      type: 'activity',
      title: 'Visit a shrine',
      start: '10:00',
      end: '12:00',
      minutes: 120,
      place: 'Tokyo',
      address: '',
      tips: [],
      cost: null,
    }
    const submittedPlan = {
      title: 'Japan plans',
      subtitle: 'Tokyo',
      startDate: '2027-03-14',
      endDate: '2027-03-14',
      days: [
        {
          dayNumber: 1,
          date: '2027-03-14',
          city: 'Tokyo',
          theme: 'Culture',
          items: [sourceActivity],
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'verified-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: memberId,
            email: 'member@example.com',
            email_verified: true,
          }),
        ),
    )
    const sessionCookie = await signIn(request, 'Member', 'member@example.com')
    const geminiFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'split-interaction' }))
      .mockResolvedValueOnce(
        Response.json({
          status: 'completed',
          output_text: JSON.stringify({
            days: [
              {
                day_number: 1,
                splits: [
                  {
                    id: 'generated-split',
                    start_time: '10:00',
                    end_time: '12:00',
                    reason: 'Explore a different cultural site.',
                    branches: [
                      {
                        id: 'member-branch',
                        label: 'Alternative',
                        traveler_ids: [memberId, 'auth0|friend'],
                        timeline: [
                          {
                            id: 'alternative-1',
                            item_type: 'activity',
                            title: 'Visit a garden',
                            start_time: '10:00',
                            end_time: '12:00',
                            duration_minutes: 120,
                            location: { name: 'Tokyo garden', address: null },
                            transit_details: null,
                            estimated_cost: null,
                            notes_and_tips: [],
                          },
                        ],
                      },
                    ],
                    rejoin_time: '12:00',
                    rejoin_location: { name: 'Tokyo', address: null },
                  },
                ],
              },
            ],
          }),
        }),
      )
    vi.stubGlobal('fetch', geminiFetch)

    const startResponse = await request(`/families/${familyCode}/plan/splits`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestedBy: memberId,
        dayNumber: 1,
        itemId: sourceActivity.id,
        plan: submittedPlan,
      }),
    })
    const { interactionToken } = (await startResponse.json()) as { interactionToken: string }
    const pollResponse = await request(
      `/families/${familyCode}/plan/splits/${encodeURIComponent(interactionToken)}`,
      { headers: { Cookie: sessionCookie } },
    )
    const stored = JSON.parse(objects.get(`travel-plans/${familyCode}`) ?? '{}') as {
      format: string
      plan: { days: Array<{ items: Array<Record<string, unknown>> }> }
    }
    const polled = (await pollResponse.json()) as { plan: unknown }

    expect(startResponse.status).toBe(202)
    expect(geminiFetch).toHaveBeenCalledTimes(2)
    expect(pollResponse.status).toBe(200)
    expect(stored.format).toBe('travel-app')
    expect(stored.plan.days[0]?.items[0]).toMatchObject({
      id: `split-${sourceActivity.id}`,
      type: 'split',
      defaultGroup: `original-${sourceActivity.id}`,
      picks: { [memberId]: `alt-${encodeURIComponent(memberId)}` },
      groups: [
        { id: `original-${sourceActivity.id}`, items: [sourceActivity] },
        {
          id: `alt-${encodeURIComponent(memberId)}`,
          ownerId: memberId,
          members: [{ userId: memberId, name: 'Member' }],
          items: [expect.objectContaining({ title: 'Visit a garden' })],
        },
      ],
    })
    expect(polled.plan).toEqual(stored.plan)

    const staleSaveResponse = await request(`/families/${familyCode}/plan`, {
      method: 'PUT',
      headers: {
        Origin: 'http://localhost',
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ updatedBy: memberId, plan: submittedPlan }),
    })
    const afterStaleSave = JSON.parse(objects.get(`travel-plans/${familyCode}`) ?? '{}') as {
      plan: { days: Array<{ items: Array<Record<string, unknown>> }> }
    }

    expect(staleSaveResponse.status).toBe(200)
    expect(afterStaleSave.plan.days[0]?.items[0]).toMatchObject({
      id: `split-${sourceActivity.id}`,
      picks: { [memberId]: `alt-${encodeURIComponent(memberId)}` },
    })
  })

  it('negotiates independently in either family collection and only the target can accept', async () => {
    const { objects, request } = testApp()
    const creatorId = 'auth0|creator'
    const memberId = 'auth0|member'
    const users = [
      {
        userProfile: { userId: creatorId, name: 'Creator', email: 'creator@example.com' },
        userTravelProfile: {
          tripPace: { value: 0.1, priority: 'flexible' },
          budgetTier: { value: 2, priority: 'critical' },
          diningCuisine: { value: 'local', priority: 'flexible' },
        },
      },
      {
        userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
        userTravelProfile: {
          tripPace: { value: 0.9, priority: 'flexible' },
          budgetTier: { value: 2, priority: 'critical' },
          diningCuisine: { value: 'local', priority: 'flexible' },
        },
      },
    ]
    const travelFamily = {
      familyCode: '1234',
      country: 'Japan',
      startDate: '2027-03-14',
      endDate: '2027-03-16',
      startTime: '09:00',
      endTime: '18:00',
      startCity: 'Tokyo',
      endCity: 'Kyoto',
      users: structuredClone(users),
    }
    objects.set('travel-families/1234', JSON.stringify(travelFamily))
    objects.set(
      'families/preferences-1234',
      JSON.stringify({ familyCode: '1234', users: structuredClone(users) }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'creator-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: creatorId,
            email: 'creator@example.com',
            email_verified: true,
          }),
        )
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'member-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: memberId,
            email: 'member@example.com',
            email_verified: true,
          }),
        ),
    )
    const creatorCookie = await signIn(request, 'Creator', 'creator@example.com')
    const memberCookie = await signIn(request, 'Member', 'member@example.com')
    expect(objects.has('travel-plans/1234')).toBe(false)
    const geminiAction = {
      action: 'ask_user',
      target_participant: 'traveler_2',
      proposed_value: 0.1,
      question: 'Would you be comfortable with a slower pace?',
      rationale: 'This compromise respects the other traveler’s preference.',
    }
    const geminiFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(geminiAction) }))
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(geminiAction) }))
    vi.stubGlobal('fetch', geminiFetch)

    const uploadedAnalysis = await request(
      '/api/preference-families/1234/negotiations/analyze',
      { headers: { Cookie: creatorCookie } },
    )
    const travelAnalysis = await request(
      '/travel/families/1234/negotiations/analyze',
      { headers: { Cookie: creatorCookie } },
    )
    expect(uploadedAnalysis.status).toBe(200)
    expect(travelAnalysis.status).toBe(200)
    const uploadedAnalysisData = (await uploadedAnalysis.json()) as {
      conflicts: unknown[]
    }
    const travelAnalysisData = (await travelAnalysis.json()) as { conflicts: unknown[] }
    expect(uploadedAnalysisData.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ preference: 'tripPace' })]),
    )
    expect(travelAnalysisData.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ preference: 'tripPace' })]),
    )

    const consentStatusResponse = await request(
      '/api/preference-families/1234/negotiations/status',
      { headers: { Cookie: creatorCookie } },
    )
    expect(await consentStatusResponse.json()).toMatchObject({
      sessionStatus: 'awaiting_consent',
      sessionQuestionCount: 0,
    })
    const preConsentRequest = await request(
      '/api/preference-families/1234/negotiations/requests',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'pace-request-1',
        },
        body: JSON.stringify({ preference: 'tripPace', targetUserId: memberId }),
      },
    )
    expect(preConsentRequest.status).toBe(409)
    expect(await preConsentRequest.json()).toMatchObject({
      error: 'Start a balancing session before creating a question.',
    })
    const uploadedSessionResponse = await request(
      '/api/preference-families/1234/negotiations/start',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost', Cookie: creatorCookie },
      },
    )
    expect(await uploadedSessionResponse.json()).toMatchObject({
      sessionStatus: 'active',
      sessionQuestionCount: 0,
    })

    const requestBody = JSON.stringify({ preference: 'tripPace', targetUserId: memberId })
    const createdResponse = await request('/api/preference-families/1234/negotiations/requests', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'pace-request-1',
      },
      body: requestBody,
    })
    const created = (await createdResponse.json()) as {
      request: { requestId: string; targetUserId: string; status: string }
    }
    expect(createdResponse.status).toBe(201)
    expect(created.request).toMatchObject({
      targetUserId: memberId,
      status: 'pending',
      requesterUserId: creatorId,
    })
    expect(geminiFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(objects.get('families/preferences-1234') ?? '{}')).toHaveProperty(
      'negotiationState',
    )
    expect(JSON.parse(objects.get('travel-families/1234') ?? '{}')).not.toHaveProperty(
      'negotiationState',
    )

    const duplicateResponse = await request('/api/preference-families/1234/negotiations/requests', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'pace-request-1',
      },
      body: requestBody,
    })
    expect(duplicateResponse.status).toBe(200)
    const duplicate = (await duplicateResponse.json()) as { status: string }
    expect(duplicate.status).toBe('existing')
    expect(geminiFetch).toHaveBeenCalledOnce()

    const deniedResponse = await request(
      `/api/preference-families/1234/negotiations/${created.request.requestId}/respond`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: 'accept', userId: memberId }),
      },
    )
    expect(deniedResponse.status).toBe(403)

    const acceptedResponse = await request(
      `/api/preference-families/1234/negotiations/${created.request.requestId}/respond`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: memberCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: 'accept' }),
      },
    )
    expect(acceptedResponse.status).toBe(200)
    const preferenceFamily = JSON.parse(objects.get('families/preferences-1234') ?? '{}') as {
      familyCode: string
      users: Array<{ userProfile: { userId: string }; userTravelProfile: Record<string, { value: unknown }> }>
      negotiationState: { requests: Array<{ status: string; targetUserId: string }> }
    }
    expect(preferenceFamily.familyCode).toBe('1234')
    expect(preferenceFamily.users[1]?.userTravelProfile.tripPace).toMatchObject({
      value: 0.1,
      priority: 'flexible',
    })
    expect(preferenceFamily.users[1]?.userTravelProfile.budgetTier).toMatchObject({
      value: 2,
      priority: 'critical',
    })
    expect(preferenceFamily.users[1]?.userTravelProfile.diningCuisine).toMatchObject({
      value: 'local',
      priority: 'flexible',
    })
    expect(objects.has('travel-plans/1234')).toBe(false)
    expect(preferenceFamily.negotiationState.requests[0]).toMatchObject({
      status: 'accepted',
      targetUserId: memberId,
    })
    expect(JSON.parse(objects.get('travel-families/1234') ?? '{}')).not.toHaveProperty(
      'negotiationState',
    )

    const travelSessionResponse = await request(
      '/travel/families/1234/negotiations/start',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost', Cookie: creatorCookie },
      },
    )
    expect(await travelSessionResponse.json()).toMatchObject({
      sessionStatus: 'active',
      sessionQuestionCount: 0,
    })
    const travelRequestResponse = await request('/travel/families/1234/negotiations/requests', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'travel-pace-request-1',
      },
      body: requestBody,
    })
    const travelRequest = (await travelRequestResponse.json()) as {
      request: { requestId: string }
    }
    expect(travelRequestResponse.status).toBe(201)

    const travelAcceptedResponse = await request(
      `/travel/families/1234/negotiations/${travelRequest.request.requestId}/respond`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: memberCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: 'accept' }),
      },
    )
    expect(travelAcceptedResponse.status).toBe(200)
    const acceptedTravelFamily = JSON.parse(objects.get('travel-families/1234') ?? '{}') as {
      users: Array<{ userTravelProfile: Record<string, { value: unknown }> }>
      negotiationState: { requests: Array<{ status: string }> }
    }
    expect(acceptedTravelFamily.users[1]?.userTravelProfile.tripPace.value).toBe(0.1)
    expect(acceptedTravelFamily.negotiationState.requests[0]?.status).toBe('accepted')
    expect(JSON.parse(objects.get('families/preferences-1234') ?? '{}')).toMatchObject({
      negotiationState: { requests: [expect.objectContaining({ status: 'accepted' })] },
    })

    const cappedFamily = JSON.parse(objects.get('travel-families/1234') ?? '{}') as {
      users: Array<{ userTravelProfile: Record<string, unknown> }>
      negotiationState: {
        requests: Array<Record<string, unknown>>
        session: { id: string }
        resolvedPreferences: Record<string, string>
      }
    }
    cappedFamily.users[0]!.userTravelProfile.travelStyle = {
      value: 0.1,
      priority: 'flexible',
    }
    cappedFamily.users[1]!.userTravelProfile.travelStyle = {
      value: 0.9,
      priority: 'flexible',
    }
    const activeSessionId = cappedFamily.negotiationState.session.id
    cappedFamily.negotiationState.requests.push(
      ...Array.from({ length: 11 }, (_, index) => ({
        requestId: `historical-${index}`,
        familyCode: '1234',
        requesterUserId: creatorId,
        targetUserId: memberId,
        targetName: 'Member',
        preference: `historicalPreference${index}`,
        currentValue: 0,
        proposedValue: 1,
        question: 'Historical question',
        rationale: 'Historical test record',
        status: 'rejected',
        createdAt: '2026-01-01T00:00:00.000Z',
        attempt: 1,
        sessionId: activeSessionId,
      })),
    )
    objects.set('travel-families/1234', JSON.stringify(cappedFamily))

    const overLimitResponse = await request('/travel/families/1234/negotiations/requests', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'over-limit-travel-style-request',
      },
      body: JSON.stringify({ preference: 'travelStyle', targetUserId: memberId }),
    })
    expect(overLimitResponse.status).toBe(409)
    expect(await overLimitResponse.json()).toMatchObject({
      error: 'Negotiation reached this session’s question limit.',
    })
    expect(geminiFetch).toHaveBeenCalledTimes(2)

    cappedFamily.negotiationState.resolvedPreferences.travelStyle = 'review'
    objects.set('travel-families/1234', JSON.stringify(cappedFamily))
    const reachedLimitStatus = await request(
      '/travel/families/1234/negotiations/status',
      { headers: { Cookie: creatorCookie } },
    )
    const limitStatus = (await reachedLimitStatus.json()) as {
      sessionStatus: string
      sessionId: string
      sessionQuestionCount: number
    }
    expect(limitStatus).toMatchObject({
      sessionStatus: 'limit_reached',
      sessionQuestionCount: 12,
    })
    const restartResponse = await request('/travel/families/1234/negotiations/start', {
      method: 'POST',
      headers: { Origin: 'http://localhost', Cookie: creatorCookie },
    })
    expect(await restartResponse.json()).toMatchObject({
      sessionStatus: 'active',
      sessionQuestionCount: 0,
      resolvedPreferences: {},
    })
    const restartedFamily = JSON.parse(objects.get('travel-families/1234') ?? '{}') as {
      users: Array<{ userTravelProfile: Record<string, unknown> }>
      negotiationState: { requests: unknown[]; session: { id: string } }
    }
    expect(restartedFamily.negotiationState.requests).toHaveLength(12)
    expect(restartedFamily.negotiationState.session.id).not.toBe(limitStatus.sessionId)
    expect(restartedFamily.users[1]?.userTravelProfile.tripPace).toMatchObject({
      value: 0.1,
      priority: 'flexible',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          output_text: JSON.stringify({
            action: 'ask_user',
            target_participant: 'traveler_2',
            proposed_value: 0.5,
            question: 'Would a more exploratory trip feel right?',
            rationale: 'A middle ground may work for the group.',
          }),
        }),
      ),
    )
    const newSessionQuestion = await request(
      '/travel/families/1234/negotiations/requests',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'question-after-restart',
        },
        body: JSON.stringify({ preference: 'travelStyle', targetUserId: memberId }),
      },
    )
    expect(newSessionQuestion.status).toBe(201)
    const newSessionStatus = await request(
      '/travel/families/1234/negotiations/status',
      { headers: { Cookie: creatorCookie } },
    )
    expect(await newSessionStatus.json()).toMatchObject({
      sessionStatus: 'active',
      sessionQuestionCount: 1,
    })
  })

  it('queues and runs bounded follow-up negotiation after a rejection', async () => {
    const { env, jobs, objects, request } = testApp()
    const creatorId = 'auth0|creator'
    const memberId = 'auth0|member'
    const familyCode = '8912'
    objects.set(
      `travel-families/${familyCode}`,
      JSON.stringify({
        familyCode,
        country: 'Japan',
        startDate: '2027-03-14',
        endDate: '2027-03-16',
        startTime: '09:00',
        endTime: '18:00',
        startCity: '',
        endCity: '',
        users: [
          {
            userProfile: { userId: creatorId, name: 'Creator', email: 'creator@example.com' },
            userTravelProfile: { tripPace: { value: 0.1, priority: 'flexible' } },
          },
          {
            userProfile: { userId: memberId, name: 'Member', email: 'member@example.com' },
            userTravelProfile: { tripPace: { value: 0.9, priority: 'flexible' } },
          },
          {
            userProfile: {
              userId: 'auth0|third',
              name: 'Third',
              email: 'third@example.com',
            },
            userTravelProfile: { tripPace: { value: 0.5, priority: 'flexible' } },
          },
        ],
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'creator-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: creatorId,
            email: 'creator@example.com',
            email_verified: true,
          }),
        )
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ access_token: 'member-access-token' }))
        .mockResolvedValueOnce(
          Response.json({
            sub: memberId,
            email: 'member@example.com',
            email_verified: true,
          }),
        ),
    )
    const creatorCookie = await signIn(request, 'Creator', 'creator@example.com')
    const memberCookie = await signIn(request, 'Member', 'member@example.com')
    const geminiAction = {
      action: 'ask_user',
      target_participant: 'traveler_2',
      proposed_value: 0.2,
      question: 'Would you accept a moderate pace instead?',
      rationale: 'A middle value narrows the preference difference.',
    }
    const geminiFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ output_text: JSON.stringify(geminiAction) }))
    vi.stubGlobal('fetch', geminiFetch)

    const sessionResponse = await request(
      `/travel/families/${familyCode}/negotiations/start`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost', Cookie: creatorCookie },
      },
    )
    expect(sessionResponse.status).toBe(200)
    const createdResponse = await request(
      `/travel/families/${familyCode}/negotiations/requests`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'initial-pace-request',
        },
        body: JSON.stringify({ preference: 'tripPace', targetUserId: memberId }),
      },
    )
    const created = (await createdResponse.json()) as { request: { requestId: string } }
    expect(createdResponse.status).toBe(201)

    const rejectedResponse = await request(
      `/travel/families/${familyCode}/negotiations/${created.request.requestId}/respond`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: memberCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: 'reject', note: 'I prefer my original pace.' }),
      },
    )
    expect(rejectedResponse.status).toBe(200)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      type: 'travel-negotiation-followup',
      payload: {
        source: 'travel-families',
        familyCode,
        requesterUserId: memberId,
        triggerRequestId: created.request.requestId,
      },
    })

    const repeatedRequest = await request(
      `/travel/families/${familyCode}/negotiations/requests`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'second-pace-request',
        },
        body: JSON.stringify({ preference: 'tripPace', targetUserId: memberId }),
      },
    )
    expect(repeatedRequest.status).toBe(409)
    expect(await repeatedRequest.json()).toMatchObject({
      error: 'This traveler has already been asked about this preference.',
    })
    expect(geminiFetch).toHaveBeenCalledOnce()

    const followupGeminiAction = {
      ...geminiAction,
      target_participant: 'traveler_1',
      proposed_value: 0.5,
    }
    const followupGeminiFetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ output_text: JSON.stringify(followupGeminiAction) }),
      )
    vi.stubGlobal('fetch', followupGeminiFetch)
    const result = await runJob(
      {
        type: 'travel-negotiation-followup',
        payload: jobs[0].payload,
      } as Parameters<typeof runJob>[0],
      { progress: vi.fn() } as unknown as Parameters<typeof runJob>[1],
      env,
    )
    expect(result).toMatchObject({ stopped: false, created: [expect.any(String)] })
    expect(followupGeminiFetch).toHaveBeenCalledOnce()
    const duplicatePairResponse = await request(
      `/travel/families/${familyCode}/negotiations/requests`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: memberCookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'repeat-trip-pace-target',
        },
        body: JSON.stringify({ preference: 'tripPace', targetUserId: creatorId }),
      },
    )
    expect(duplicatePairResponse.status).toBe(409)
    expect(await duplicatePairResponse.json()).toMatchObject({
      error: 'This traveler has already been asked about this preference.',
    })
    expect(followupGeminiFetch).toHaveBeenCalledOnce()
    const storedFamily = JSON.parse(objects.get(`travel-families/${familyCode}`) ?? '{}') as {
      negotiationState: {
        requests: Array<{
          status: string
          attempt: number
          requesterUserId: string
          targetUserId: string
          preference: string
        }>
      }
    }
    expect(storedFamily.negotiationState.requests).toMatchObject([
      {
        status: 'rejected',
        attempt: 1,
        requesterUserId: creatorId,
        targetUserId: memberId,
        preference: 'tripPace',
      },
      {
        status: 'pending',
        attempt: 1,
        requesterUserId: memberId,
        targetUserId: creatorId,
        preference: 'tripPace',
      },
    ])
  })
})
