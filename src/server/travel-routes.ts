import type { Context, Hono } from 'hono'
import type { ActionResult, GetActionData, MutateActionData } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'

const SESSION_COOKIE = 'travel_session'
const PENDING_COOKIE = 'travel_pending'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const PENDING_TTL_SECONDS = 60 * 5

interface TravelSession {
  userId: string
  email: string
  name: string
  expiresAt: number
}

interface PendingSignIn {
  email: string
  name: string
  expiresAt: number
}

interface TravelUser {
  userId: string
  name: string
  email: string
  emailVerified: boolean
  avatar: string
  families: string[]
}

interface FamilyMember {
  userProfile: {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    organizer: boolean
    avatar?: string
  }
  userTravelProfile: Record<string, unknown>
}

interface TravelFamily {
  family_code: string
  family_id: string
  country: string
  startDate: string
  endDate: string
  ownerId: string
  users: FamilyMember[]
}

function jsonError(
  c: Context<AppContext>,
  error: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503,
) {
  return c.json({ error }, status)
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function signValue(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))
}

async function seal<T extends { expiresAt: number }>(secret: string, value: T): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)))
  return `${payload}.${await signValue(secret, payload)}`
}

async function unseal<T extends { expiresAt: number }>(
  secret: string,
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      asArrayBuffer(decodeBase64Url(signature)),
      new TextEncoder().encode(payload),
    )
    if (!valid) return null
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as T
    return typeof value.expiresAt === 'number' && value.expiresAt > Date.now() ? value : null
  } catch {
    return null
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get('Cookie') ?? ''
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

function setCookie(c: Context<AppContext>, name: string, value: string, maxAge: number): void {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''
  c.header(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    { append: true },
  )
}

function clearCookie(c: Context<AppContext>, name: string): void {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''
  c.header(
    'Set-Cookie',
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    { append: true },
  )
}

function isSameOrigin(c: Context<AppContext>): boolean {
  const origin = c.req.header('Origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}

function sessionSecret(env: Env): string | null {
  const secret = env.AUTH0_SESSION_SECRET
  return secret && secret.length >= 32 ? secret : null
}

async function currentSession(
  c: Context<AppContext>,
): Promise<{ session: TravelSession } | { response: Response }> {
  const secret = sessionSecret(c.env)
  if (!secret) {
    return {
      response: jsonError(c, 'Auth0 session signing is not configured. Set AUTH0_SESSION_SECRET.', 503),
    }
  }
  const session = await unseal<TravelSession>(secret, cookieValue(c.req.raw, SESSION_COOKIE))
  if (!session?.userId || !session.email) {
    return { response: jsonError(c, 'Sign in required.', 401) }
  }
  return { session }
}

async function readJsonBody(c: Context<AppContext>): Promise<Record<string, unknown> | null> {
  const contentLength = Number(c.req.header('Content-Length') ?? 0)
  if (contentLength > 128_000) return null
  try {
    const body: unknown = await c.req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function auth0Config(env: Env): { domain: string; clientId: string; clientSecret?: string } | null {
  const domain = env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//u, '').replace(/\/$/u, '')
  const clientId = env.AUTH0_CLIENT_ID?.trim()
  if (!domain || !clientId || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(domain)) return null
  const clientSecret = env.AUTH0_CLIENT_SECRET?.trim()
  return { domain, clientId, ...(clientSecret ? { clientSecret } : {}) }
}

async function auth0Json(
  url: string,
  body?: URLSearchParams | Record<string, string>,
  accessToken?: string,
  successBody: 'json' | 'status' = 'json',
): Promise<{ data: Record<string, unknown>; status: number }> {
  let response: Response
  try {
    const formBody = body instanceof URLSearchParams
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body
          ? { 'Content-Type': formBody ? 'application/x-www-form-urlencoded' : 'application/json' }
          : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: formBody ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('Could not reach Auth0. Check the tenant domain and try again.')
  }
  if (response.ok && successBody === 'status') {
    return { data: {}, status: response.status }
  }
  let data: Record<string, unknown>
  try {
    const responseText = await response.text()
    const parsed: unknown = JSON.parse(responseText)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Expected a JSON object.')
    }
    data = parsed as Record<string, unknown>
  } catch {
    if (!response.ok) {
      throw Object.assign(
        new Error(`Auth0 returned HTTP ${response.status} from the authentication endpoint.`),
        { status: response.status },
      )
    }
    throw new Error('Auth0 returned an invalid response.')
  }
  if (!response.ok) {
    const description =
      (typeof data.error_description === 'string' && data.error_description) ||
      (typeof data.message === 'string' && data.message) ||
      (typeof data.error === 'string' && data.error) ||
      `HTTP ${response.status}`
    throw Object.assign(new Error(description), { status: response.status, code: data.error })
  }
  return { data, status: response.status }
}

function keyParts(key: string): { collection: string; recordId: string } {
  const userMatch = /^users\/(.+)\.json$/u.exec(key)
  if (userMatch) {
    return { collection: 'travel-users', recordId: decodeURIComponent(userMatch[1]) }
  }
  const familyMatch = /^families\/(\d{4})\.json$/u.exec(key)
  if (familyMatch) return { collection: 'travel-families', recordId: familyMatch[1] }
  throw new Error('Invalid travel record key.')
}

async function executeRecordTool<T>(
  env: Env,
  tool: string,
  params: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const room = env.RECORD_ROOMS.get(
    env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`),
  )
  const response = await room.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': env.OWNER_USER_ID,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }),
  )
  if (!response.ok) throw new Error(`DeepSpace record operation failed (${response.status}).`)
  const result = (await response.json()) as ActionResult<T>
  if (!result.success) throw new Error(`DeepSpace record operation failed: ${result.error}`)
  return result
}

async function getStored<T>(env: Env, key: string): Promise<T | null> {
  const { collection, recordId } = keyParts(key)
  const room = env.RECORD_ROOMS.get(
    env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`),
  )
  const response = await room.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': env.OWNER_USER_ID,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({
        tool: 'records.get',
        params: { collection, recordId },
      }),
    }),
  )
  if (!response.ok) throw new Error(`DeepSpace record read failed (${response.status}).`)
  const result = (await response.json()) as ActionResult<GetActionData>
  if (!result.success) {
    if (/not found|does not exist/iu.test(result.error)) return null
    throw new Error(`DeepSpace record read failed: ${result.error}`)
  }
  return result.data.record.data as T
}

async function putStored(env: Env, key: string, value: unknown): Promise<void> {
  const { collection, recordId } = keyParts(key)
  const current = await getStored(env, key)
  if (current) {
    await executeRecordTool<MutateActionData>(env, 'records.update', {
      collection,
      recordId,
      data: value,
    })
    return
  }
  try {
    await executeRecordTool<MutateActionData>(env, 'records.create', {
      collection,
      recordId,
      data: value,
    })
  } catch (createError) {
    const raced = await getStored(env, key)
    if (!raced) throw createError
    await executeRecordTool<MutateActionData>(env, 'records.update', {
      collection,
      recordId,
      data: value,
    })
  }
}

async function createStored(env: Env, key: string, value: unknown): Promise<void> {
  const { collection, recordId } = keyParts(key)
  await executeRecordTool<MutateActionData>(env, 'records.create', {
    collection,
    recordId,
    data: value,
  })
}

function userKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}.json`
}

function familyKey(familyCode: string): string {
  return `families/${familyCode}.json`
}

function validFamilyCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/u.test(value)
}

function memberFor(user: TravelUser, organizer: boolean): FamilyMember {
  return {
    userProfile: {
      userId: user.userId,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      organizer,
      avatar: user.avatar,
    },
    userTravelProfile: {},
  }
}

async function persistFamily(env: Env, family: TravelFamily): Promise<void> {
  await putStored(env, familyKey(family.family_code), family)
}

function familyResponse(family: TravelFamily, includeMembers = true) {
  return {
    family_code: family.family_code,
    country: family.country,
    startDate: family.startDate,
    endDate: family.endDate,
    users: includeMembers ? family.users : [],
  }
}

async function requireFamilyMember(
  c: Context<AppContext>,
  familyCode: string,
  userId: string,
): Promise<{ family: TravelFamily } | { response: Response }> {
  const family = await getStored<TravelFamily>(c.env, familyKey(familyCode))
  if (!family) return { response: jsonError(c, 'That family code was not found.', 404) }
  if (!family.users.some((member) => member.userProfile.userId === userId)) {
    return { response: jsonError(c, 'You are not a member of this family.', 403) }
  }
  return { family }
}

export function registerTravelRoutes(app: Hono<AppContext>): void {
  for (const path of ['/auth/*', '/users/*', '/families/*']) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
  }

  app.post('/auth/start', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const body = await readJsonBody(c)
    if (!body) return jsonError(c, 'Expected a JSON request body.', 400)
    const name = body.name
    const email = body.email
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      return jsonError(c, 'Enter a name between 1 and 80 characters.', 400)
    }
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email.trim())
    ) {
      return jsonError(c, 'Enter a valid email address.', 400)
    }
    const config = auth0Config(c.env)
    const secret = sessionSecret(c.env)
    if (!config || !secret) {
      return jsonError(
        c,
        'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_SESSION_SECRET.',
        503,
      )
    }
    try {
      await auth0Json(
        `https://${config.domain}/passwordless/start`,
        {
          client_id: config.clientId,
          ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
          connection: 'email',
          email: email.trim(),
          send: 'code',
        },
        undefined,
        'status',
      )
      const pending = await seal(secret, {
        email: email.trim(),
        name: name.trim(),
        expiresAt: Date.now() + PENDING_TTL_SECONDS * 1000,
      })
      setCookie(c, PENDING_COOKIE, pending, PENDING_TTL_SECONDS)
      return c.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send the code.'
      return jsonError(c, message, 502)
    }
  })

  app.post('/auth/verify', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const body = await readJsonBody(c)
    if (!body) return jsonError(c, 'Expected a JSON request body.', 400)
    const email = body.email
    const code = body.code
    if (
      typeof email !== 'string' ||
      typeof code !== 'string' ||
      !/^\d{4,10}$/u.test(code.trim())
    ) {
      return jsonError(c, 'Email and verification code are required.', 400)
    }
    const config = auth0Config(c.env)
    const secret = sessionSecret(c.env)
    if (!config || !secret) {
      return jsonError(
        c,
        'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_SESSION_SECRET.',
        503,
      )
    }
    try {
      const pending = await unseal<PendingSignIn>(secret, cookieValue(c.req.raw, PENDING_COOKIE))
      if (!pending || pending.email.toLowerCase() !== email.trim().toLowerCase()) {
        return jsonError(c, 'Sign-in expired. Request a new email code.', 401)
      }
      const tokenBody = new URLSearchParams({
        grant_type: 'http://auth0.com/oauth/grant-type/passwordless/otp',
        client_id: config.clientId,
        username: pending.email,
        otp: code.trim(),
        realm: 'email',
        scope: 'openid profile email',
      })
      if (config.clientSecret) tokenBody.set('client_secret', config.clientSecret)
      const tokenResponse = await auth0Json(
        `https://${config.domain}/oauth/token`,
        tokenBody,
      )
      const accessToken = tokenResponse.data.access_token
      if (typeof accessToken !== 'string' || !accessToken) {
        return jsonError(c, 'Auth0 did not return an access token.', 502)
      }
      const { data: userInfo } = await auth0Json(
        `https://${config.domain}/userinfo`,
        undefined,
        accessToken,
      )
      const verifiedEmail = userInfo.email
      const userId = userInfo.sub
      if (
        typeof verifiedEmail !== 'string' ||
        userInfo.email_verified !== true ||
        typeof userId !== 'string' ||
        !userId ||
        verifiedEmail.toLowerCase() !== pending.email.toLowerCase()
      ) {
        return jsonError(c, 'Auth0 did not verify this email address.', 401)
      }
      const oldUser = await getStored<TravelUser>(c.env, userKey(userId))
      const user: TravelUser = {
        userId,
        name: pending.name,
        email: verifiedEmail,
        emailVerified: true,
        avatar: oldUser?.avatar || 'taj',
        families: oldUser?.families ?? [],
      }
      await putStored(c.env, userKey(userId), user)
      const session = await seal(secret, {
        userId,
        email: verifiedEmail,
        name: user.name,
        expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
      })
      setCookie(c, SESSION_COOKIE, session, SESSION_TTL_SECONDS)
      clearCookie(c, PENDING_COOKIE)
      return c.json({ userId, name: user.name, email: verifiedEmail })
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'invalid_grant'
          ? 401
          : 502
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      const message =
        status === 401 && code === 'invalid_grant'
          ? 'That code is incorrect or expired.'
          : error instanceof Error
            ? error.message
            : 'Could not complete Auth0 sign-in.'
      return jsonError(c, message, status)
    }
  })

  app.get('/auth/me', async (c) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const user = await getStored<TravelUser>(c.env, userKey(result.session.userId))
    return c.json({
      user: {
        userId: result.session.userId,
        name: user?.name ?? result.session.name,
        email: result.session.email,
        avatar: user?.avatar ?? 'taj',
      },
    })
  })

  app.post('/auth/sign-out', (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    clearCookie(c, SESSION_COOKIE)
    clearCookie(c, PENDING_COOKIE)
    return c.json({ success: true })
  })

  app.patch('/users/:userId', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const userId = c.req.param('userId')
    if (userId !== result.session.userId) return jsonError(c, 'Not authorized.', 401)
    const body = await readJsonBody(c)
    if (!body) return jsonError(c, 'Expected a JSON request body.', 400)
    const user = await getStored<TravelUser>(c.env, userKey(userId))
    if (!user) return jsonError(c, 'User not found.', 404)
    if (typeof body.name === 'string' && body.name.trim() && body.name.trim().length <= 80) {
      user.name = body.name.trim()
    }
    if (typeof body.avatar === 'string' && body.avatar.length <= 40) {
      user.avatar = body.avatar
    }
    await putStored(c.env, userKey(userId), user)
    return c.json({ success: true })
  })

  app.get('/users/:userId/families', async (c) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const userId = c.req.param('userId')
    if (userId !== result.session.userId) return jsonError(c, 'Not authorized.', 401)
    const user = await getStored<TravelUser>(c.env, userKey(userId))
    if (!user) return c.json([])
    const families = await Promise.all(
      user.families.map((code) => getStored<TravelFamily>(c.env, familyKey(code))),
    )
    return c.json(
      families
        .filter((family): family is TravelFamily => family !== null)
        .map((family) => familyResponse(family)),
    )
  })

  app.post('/families', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const body = await readJsonBody(c)
    if (
      !body ||
      typeof body.country !== 'string' ||
      !body.country.trim() ||
      body.country.trim().length > 120 ||
      typeof body.startDate !== 'string' ||
      typeof body.endDate !== 'string' ||
      !body.startDate.trim() ||
      !body.endDate.trim() ||
      !Number.isFinite(Date.parse(body.startDate)) ||
      !Number.isFinite(Date.parse(body.endDate)) ||
      Date.parse(body.endDate) <= Date.parse(body.startDate)
    ) {
      return jsonError(c, 'Country and valid trip dates are required, and the end must be after the start.', 400)
    }
    const user = await getStored<TravelUser>(c.env, userKey(result.session.userId))
    if (!user) return jsonError(c, 'Sign in again to create a trip.', 401)
    let family: TravelFamily | null = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const random = new Uint32Array(1)
      crypto.getRandomValues(random)
      const candidate = String(random[0] % 10_000).padStart(4, '0')
      const candidateFamily: TravelFamily = {
        family_code: candidate,
        family_id: candidate,
        country: body.country.trim(),
        startDate: body.startDate.trim(),
        endDate: body.endDate.trim(),
        ownerId: user.userId,
        users: [memberFor(user, true)],
      }
      try {
        await createStored(c.env, familyKey(candidate), candidateFamily)
        family = candidateFamily
        break
      } catch (error) {
        if (!(await getStored<TravelFamily>(c.env, familyKey(candidate)))) throw error
      }
    }
    if (!family) return jsonError(c, 'Could not create a unique family code. Try again.', 503)
    user.families = [...new Set([...user.families, family.family_code])]
    await putStored(c.env, userKey(user.userId), user)
    return c.json({ family_code: family.family_code })
  })

  app.post('/families/lookup', async (c) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const body = await readJsonBody(c)
    if (!body || !validFamilyCode(body.family_code)) {
      return jsonError(c, 'Enter a valid 4-digit family code.', 400)
    }
    const family = await getStored<TravelFamily>(c.env, familyKey(body.family_code))
    if (!family) return jsonError(c, 'That family code was not found. Check it and try again.', 404)
    const isMember = family.users.some(
      (member) => member.userProfile.userId === result.session.userId,
    )
    return c.json(familyResponse(family, isMember))
  })

  app.post('/families/join', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const body = await readJsonBody(c)
    if (!body || !validFamilyCode(body.family_code)) {
      return jsonError(c, 'Enter a valid 4-digit family code.', 400)
    }
    if (body.userId !== result.session.userId) return jsonError(c, 'Not authorized.', 401)
    const family = await getStored<TravelFamily>(c.env, familyKey(body.family_code))
    if (!family) return jsonError(c, 'That family code was not found. Check it and try again.', 404)
    const user = await getStored<TravelUser>(c.env, userKey(result.session.userId))
    if (!user) return jsonError(c, 'Sign in again to join this trip.', 401)
    if (!family.users.some((member) => member.userProfile.userId === user.userId)) {
      family.users.push(memberFor(user, false))
      await persistFamily(c.env, family)
    }
    user.families = [...new Set([...user.families, family.family_code])]
    await putStored(c.env, userKey(user.userId), user)
    return c.json({ success: true })
  })

  app.put('/families/:familyId', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const code = c.req.param('familyId')
    if (!validFamilyCode(code)) return jsonError(c, 'Family not found.', 404)
    const family = await getStored<TravelFamily>(c.env, familyKey(code))
    if (!family) return jsonError(c, 'Family not found.', 404)
    const body = await readJsonBody(c)
    if (!body || body.userId !== result.session.userId || family.ownerId !== result.session.userId) {
      return jsonError(c, 'Only the trip creator can change the trip details.', 401)
    }
    if (
      typeof body.country !== 'string' ||
      !body.country.trim() ||
      typeof body.startDate !== 'string' ||
      typeof body.endDate !== 'string' ||
      !body.startDate.trim() ||
      !body.endDate.trim() ||
      !Number.isFinite(Date.parse(body.startDate)) ||
      !Number.isFinite(Date.parse(body.endDate)) ||
      Date.parse(body.endDate) <= Date.parse(body.startDate)
    ) {
      return jsonError(c, 'Country and valid trip dates are required, and the end must be after the start.', 400)
    }
    family.country = body.country.trim()
    family.startDate = body.startDate.trim()
    family.endDate = body.endDate.trim()
    await persistFamily(c.env, family)
    return c.json({ success: true })
  })

  app.get('/families/:familyId/members/:userId/travel-profile', async (c) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const familyCode = c.req.param('familyId')
    const userId = c.req.param('userId')
    if (userId !== result.session.userId || !validFamilyCode(familyCode)) {
      return jsonError(c, 'Not authorized.', 401)
    }
    const access = await requireFamilyMember(c, familyCode, userId)
    if ('response' in access) return access.response
    const member = access.family.users.find((entry) => entry.userProfile.userId === userId)
    return c.json({ userTravelProfile: member?.userTravelProfile ?? null })
  })

  app.put('/families/:familyId/members/:userId/travel-profile', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const familyCode = c.req.param('familyId')
    const userId = c.req.param('userId')
    if (userId !== result.session.userId || !validFamilyCode(familyCode)) {
      return jsonError(c, 'Not authorized.', 401)
    }
    const body = await readJsonBody(c)
    if (
      !body ||
      body.userTravelProfile === null ||
      typeof body.userTravelProfile !== 'object' ||
      Array.isArray(body.userTravelProfile)
    ) {
      return jsonError(c, 'Expected a travel preferences object.', 400)
    }
    const access = await requireFamilyMember(c, familyCode, userId)
    if ('response' in access) return access.response
    const member = access.family.users.find((entry) => entry.userProfile.userId === userId)
    if (!member) return jsonError(c, 'Family member not found.', 404)
    member.userTravelProfile = body.userTravelProfile as Record<string, unknown>
    await persistFamily(c.env, access.family)
    return c.json({ success: true })
  })
}
