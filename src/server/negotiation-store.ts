import type {
  ActionResult,
  GetActionData,
  MutateActionData,
  QueryActionData,
} from 'deepspace/worker'
import type { Env } from '../../worker.js'
import {
  askGeminiForNegotiation,
  detectNegotiationConflicts,
  maxTotalNegotiationRequests,
  NegotiationError,
  negotiationLimits,
  parseNegotiationMembers,
  parseNegotiationState,
  reconcileNegotiationState,
  validateProposedPreference,
} from './negotiation.js'
import type {
  NegotiationConflict,
  NegotiationMember,
  NegotiationRequest,
  NegotiationState,
} from './negotiation.js'

export type NegotiationSource = 'families' | 'travel-families'

interface FamilyRecordData {
  familyCode: string
  users: NegotiationMember[]
  negotiationState?: unknown
  [key: string]: unknown
}

interface LoadedFamily {
  source: NegotiationSource
  familyCode: string
  recordId: string
  data: FamilyRecordData
  members: NegotiationMember[]
  state: NegotiationState
}

interface NegotiationLock {
  lockKey: string
  token: string
  expiresAt: number
}

const LOCK_LEASE_MS = 60_000
const LOCK_WAIT_ATTEMPTS = 120
const LOCK_POLL_INTERVAL_MS = 250

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function executeRecordTool<T>(
  env: Env,
  tool: string,
  params: Record<string, unknown>,
): Promise<T> {
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
  let result: ActionResult<T>
  try {
    result = (await response.json()) as ActionResult<T>
  } catch {
    throw new Error(`DeepSpace record operation returned an invalid response (${response.status}).`)
  }
  if (!result.success) throw new Error(`DeepSpace record operation failed: ${result.error}`)
  if (!response.ok) throw new Error(`DeepSpace record operation failed (${response.status}).`)
  return result.data
}

async function loadFamilyRecord(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
): Promise<LoadedFamily> {
  if (
    !familyCode.trim() ||
    familyCode.length > 128 ||
    (source === 'travel-families' && !/^\d{4}$/u.test(familyCode))
  ) {
    throw new NegotiationError('Family not found.', 404)
  }

  let recordId: string
  let data: unknown
  if (source === 'travel-families') {
    recordId = familyCode
    const result = await executeRecordTool<GetActionData<FamilyRecordData>>(env, 'records.get', {
      collection: source,
      recordId,
    }).catch((error: unknown) => {
      if (error instanceof Error && /not found|does not exist/iu.test(error.message)) return null
      throw error
    })
    data = result?.record.data
  } else {
    const result = await executeRecordTool<QueryActionData<FamilyRecordData>>(
      env,
      'records.query',
      { collection: source, where: { familyCode }, limit: 2 },
    )
    if (result.records.length > 1) {
      throw new Error(`Multiple preference family records found for ${familyCode}.`)
    }
    recordId = result.records[0]?.recordId ?? ''
    data = result.records[0]?.data
  }

  if (!recordId || !isRecord(data)) throw new NegotiationError('Family not found.', 404)
  if (data.familyCode !== familyCode) {
    throw new Error('The family record code does not match the requested family.')
  }
  const members = parseNegotiationMembers(data.users)
  return {
    source,
    familyCode,
    recordId,
    data: { ...data, familyCode, users: members },
    members,
    state: parseNegotiationState(data.negotiationState),
  }
}

async function saveFamilyRecord(env: Env, family: LoadedFamily): Promise<void> {
  await executeRecordTool<MutateActionData>(env, 'records.update', {
    collection: family.source,
    recordId: family.recordId,
    data: {
      users: family.members,
      negotiationState: family.state,
    },
  })
}

async function readLock(
  env: Env,
  recordId: string,
): Promise<NegotiationLock | null> {
  try {
    const result = await executeRecordTool<GetActionData<NegotiationLock>>(
      env,
      'records.get',
      { collection: 'negotiation-locks', recordId },
    )
    if (
      typeof result.record.data.lockKey !== 'string' ||
      typeof result.record.data.token !== 'string' ||
      typeof result.record.data.expiresAt !== 'number'
    ) {
      throw new Error('Stored family negotiation lock is invalid.')
    }
    return result.record.data
  } catch (error) {
    if (error instanceof Error && /not found|does not exist/iu.test(error.message)) return null
    throw error
  }
}

async function withFamilyLock<T>(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockKey = `${source}:${familyCode}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lockKey))
  const recordId = `neg-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
  const token = crypto.randomUUID()
  let acquired = false

  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    try {
      await executeRecordTool<MutateActionData>(env, 'records.create', {
        collection: 'negotiation-locks',
        recordId,
        data: { lockKey, token, expiresAt: Date.now() + LOCK_LEASE_MS },
      })
      acquired = true
      break
    } catch (createError) {
      const existing = await readLock(env, recordId)
      if (!existing) throw createError
      if (existing.token === token) {
        acquired = true
        break
      }
      if (existing.lockKey !== lockKey) {
        throw new Error('Stored family negotiation lock does not match its record ID.')
      }
      if (existing.expiresAt <= Date.now()) {
        try {
          await executeRecordTool<MutateActionData>(env, 'records.delete', {
            collection: 'negotiation-locks',
            recordId,
          })
        } catch (deleteError) {
          if (await readLock(env, recordId)) throw deleteError
        }
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS))
    }
  }
  if (!acquired) {
    throw new NegotiationError('Family negotiation is busy. Please retry shortly.', 503)
  }

  let result: T | undefined
  let operationError: unknown
  let failed = false
  try {
    result = await operation()
  } catch (error) {
    failed = true
    operationError = error
  }

  try {
    const lock = await readLock(env, recordId)
    if (!lock || lock.token !== token) {
      throw new Error('Family negotiation lock was lost before the operation completed.')
    }
    await executeRecordTool<MutateActionData>(env, 'records.delete', {
      collection: 'negotiation-locks',
      recordId,
    })
  } catch (releaseError) {
    if (failed) {
      throw new AggregateError(
        [operationError, releaseError],
        'Family negotiation operation and lock release both failed.',
      )
    }
    throw releaseError
  }
  if (failed) throw operationError
  return result as T
}

export async function withNegotiationFamilyLock<T>(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withFamilyLock(env, source, familyCode, operation)
}

function requireFamilyMember(family: LoadedFamily, userId: string): void {
  if (!family.members.some((member) => member.userProfile.userId === userId)) {
    throw new NegotiationError('You are not a member of this family.', 403)
  }
}

export async function getNegotiationStatus(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
  userId: string,
): Promise<{ familyCode: string; conflicts: NegotiationConflict[]; state: NegotiationState }> {
  return withFamilyLock(env, source, familyCode, () =>
    getNegotiationStatusLocked(env, source, familyCode, userId),
  )
}

async function getNegotiationStatusLocked(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
  userId: string,
): Promise<{ familyCode: string; conflicts: NegotiationConflict[]; state: NegotiationState }> {
  const family = await loadFamilyRecord(env, source, familyCode)
  requireFamilyMember(family, userId)
  const before = JSON.stringify(family.state)
  const conflicts = reconcileNegotiationState(family.members, family.state)
  if (JSON.stringify(family.state) !== before) await saveFamilyRecord(env, family)
  return { familyCode, conflicts, state: family.state }
}

function findConflict(
  conflicts: NegotiationConflict[],
  preference: string,
): NegotiationConflict {
  const conflict = conflicts.find((item) => item.preference === preference)
  if (!conflict) {
    throw new NegotiationError(`No conflict found for preference: ${preference}.`, 409)
  }
  return conflict
}

function findExistingRequest(
  state: NegotiationState,
  idempotencyKey: string,
): NegotiationRequest | undefined {
  const entry = state.idempotency[idempotencyKey]
  if (!entry || entry.status !== 'completed') return undefined
  return state.requests.find((request) => request.requestId === entry.requestId)
}

async function clearGenerationReservation(
  env: Env,
  source: NegotiationSource,
  familyCode: string,
  idempotencyKey: string,
): Promise<void> {
  const family = await loadFamilyRecord(env, source, familyCode)
  if (family.state.idempotency[idempotencyKey]?.status !== 'generating') return
  delete family.state.idempotency[idempotencyKey]
  await saveFamilyRecord(env, family)
}

export type CreateRequestResult =
  | { status: 'created'; request: NegotiationRequest; conflicts: NegotiationConflict[] }
  | { status: 'existing'; request: NegotiationRequest }
  | { status: 'generating'; requestId: string }
  | {
      status: 'recommended'
      action: string
      rationale: string
      conflicts: NegotiationConflict[]
    }

export async function createNegotiationRequest(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requesterUserId: string
    targetUserId?: string
    preference: string
    idempotencyKey: string
  },
): Promise<CreateRequestResult> {
  return withFamilyLock(env, input.source, input.familyCode, () =>
    createNegotiationRequestLocked(env, input),
  )
}

async function createNegotiationRequestLocked(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requesterUserId: string
    targetUserId?: string
    preference: string
    idempotencyKey: string
  },
): Promise<CreateRequestResult> {
  const family = await loadFamilyRecord(env, input.source, input.familyCode)
  requireFamilyMember(family, input.requesterUserId)

  let previous: NegotiationState['idempotency'][string] | undefined =
    family.state.idempotency[input.idempotencyKey]
  if (
    previous &&
    (previous.preference !== input.preference ||
      previous.requesterUserId !== input.requesterUserId ||
      previous.targetUserId !== input.targetUserId)
  ) {
    throw new NegotiationError('Idempotency key was already used for a different request.', 409)
  }
  if (
    previous?.status === 'generating' &&
    Date.now() - Date.parse(previous.updatedAt) > 120_000
  ) {
    delete family.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, family)
    previous = undefined
  }
  if (previous?.status === 'generating') {
    return { status: 'generating', requestId: previous.requestId }
  }
  if (previous?.status === 'completed') {
    const request = findExistingRequest(family.state, input.idempotencyKey)
    if (!request) throw new Error('Negotiation idempotency state refers to a missing request.')
    return { status: 'existing', request }
  }

  const conflicts = reconcileNegotiationState(family.members, family.state)
  const conflict = findConflict(conflicts, input.preference)
  if (negotiationLimits.nonNegotiable.has(conflict.preference)) {
    throw new NegotiationError(`${conflict.preference} is protected and cannot be negotiated.`, 409)
  }
  if (conflict.resolution !== 'negotiate') {
    throw new NegotiationError(
      `This conflict is classified as ${conflict.resolution} and cannot be negotiated.`,
      409,
    )
  }
  if (
    input.targetUserId &&
    !conflict.users.some((user) => user.userId === input.targetUserId)
  ) {
    throw new NegotiationError('Target user is not part of this family conflict.', 400)
  }
  if (
    family.state.requests.some(
      (request) => request.preference === input.preference && request.status === 'pending',
    ) ||
    Object.values(family.state.idempotency).some(
      (entry) =>
        entry.status === 'generating' && entry.preference === input.preference,
    )
  ) {
    throw new NegotiationError('A negotiation request is already pending for this family.', 409)
  }
  const attempt =
    family.state.requests.filter((request) => request.preference === input.preference).length + 1
  if (attempt > negotiationLimits.maxRequestsPerPreference) {
    throw new NegotiationError(
      `Negotiation stopped for ${input.preference} after ${negotiationLimits.maxRequestsPerPreference} requests.`,
      409,
    )
  }
  const pendingGenerations = Object.values(family.state.idempotency).filter(
    (entry) => entry.status === 'generating',
  ).length
  if (family.state.requests.length + pendingGenerations >= maxTotalNegotiationRequests(family.members)) {
    throw new NegotiationError('Negotiation reached the family-wide request limit.', 409)
  }
  const target = input.targetUserId
    ? conflict.users.find((user) => user.userId === input.targetUserId)
    : undefined
  if (target && !family.members.some((member) => member.userProfile.userId === target.userId)) {
    throw new NegotiationError('Target user is not part of this family.', 400)
  }

  const requestId = crypto.randomUUID()
  family.state.idempotency[input.idempotencyKey] = {
    requestId,
    status: 'generating',
    updatedAt: new Date().toISOString(),
    preference: input.preference,
    requesterUserId: input.requesterUserId,
    ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
  }
  await saveFamilyRecord(env, family)

  let action
  try {
    if (!env.GEMINI_API_KEY) {
      throw new NegotiationError('GEMINI_API_KEY is not configured.', 503)
    }
    action = await askGeminiForNegotiation(conflict, input.targetUserId, env.GEMINI_API_KEY)
  } catch (error) {
    await clearGenerationReservation(env, input.source, input.familyCode, input.idempotencyKey)
    throw error
  }

  if (action.action !== 'ask_user') {
    await clearGenerationReservation(env, input.source, input.familyCode, input.idempotencyKey)
    return {
      status: 'recommended',
      action: action.action,
      rationale: action.rationale,
      conflicts,
    }
  }
  if (!action.question?.trim() || action.proposed_value === undefined) {
    await clearGenerationReservation(env, input.source, input.familyCode, input.idempotencyKey)
    throw new NegotiationError('Gemini did not produce a complete user negotiation request.', 502)
  }
  const targetUserId = action.targetUserId
  if (!targetUserId || !family.members.some((member) => member.userProfile.userId === targetUserId)) {
    await clearGenerationReservation(env, input.source, input.familyCode, input.idempotencyKey)
    throw new NegotiationError('Gemini did not select a valid family member.', 502)
  }
  try {
    validateProposedPreference(input.preference, action.proposed_value)
  } catch (error) {
    await clearGenerationReservation(env, input.source, input.familyCode, input.idempotencyKey)
    throw error
  }

  const latest = await loadFamilyRecord(env, input.source, input.familyCode)
  requireFamilyMember(latest, input.requesterUserId)
  const reservation = latest.state.idempotency[input.idempotencyKey]
  if (!reservation || reservation.requestId !== requestId || reservation.status !== 'generating') {
    throw new NegotiationError('Negotiation request reservation expired; please retry.', 409)
  }
  const latestConflicts = reconcileNegotiationState(latest.members, latest.state)
  const latestConflict = latestConflicts.find((item) => item.preference === input.preference)
  if (!latestConflict || latestConflict.resolution !== 'negotiate') {
    delete latest.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, latest)
    throw new NegotiationError('The family preference conflict changed; please retry.', 409)
  }
  const current = latestConflict.users.find((user) => user.userId === targetUserId)
  if (!current) {
    delete latest.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, latest)
    throw new NegotiationError('The target user is no longer part of this conflict.', 409)
  }
  const latestAttempt =
    latest.state.requests.filter((item) => item.preference === input.preference).length + 1
  if (
    latestAttempt > negotiationLimits.maxRequestsPerPreference ||
    latest.state.requests.length +
      Object.values(latest.state.idempotency).filter(
        (entry) =>
          entry.status === 'generating' &&
          entry.requestId !== requestId,
      ).length >=
      maxTotalNegotiationRequests(latest.members)
  ) {
    delete latest.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, latest)
    throw new NegotiationError('Negotiation request limit was reached; please retry later.', 409)
  }
  if (
    latest.state.requests.some(
      (item) => item.preference === input.preference && item.status === 'pending',
    )
  ) {
    delete latest.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, latest)
    throw new NegotiationError('A negotiation request is already pending for this preference.', 409)
  }
  const latestTarget = latest.members.find(
    (member) => member.userProfile.userId === targetUserId,
  )
  if (!latestTarget) {
    delete latest.state.idempotency[input.idempotencyKey]
    await saveFamilyRecord(env, latest)
    throw new NegotiationError('The target user is no longer in this family.', 409)
  }
  const request: NegotiationRequest = {
    requestId,
    familyCode: input.familyCode,
    requesterUserId: input.requesterUserId,
    targetUserId,
    targetName: latestTarget.userProfile.name,
    preference: input.preference,
    currentValue: current.value,
    proposedValue: action.proposed_value,
    question: action.question,
    rationale: action.rationale,
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempt: latestAttempt,
  }
  latest.state.requests.push(request)
  latest.state.idempotency[input.idempotencyKey] = {
    requestId,
    status: 'completed',
    updatedAt: new Date().toISOString(),
    preference: input.preference,
    targetUserId,
    requesterUserId: input.requesterUserId,
  }
  await saveFamilyRecord(env, latest)
  return { status: 'created', request, conflicts: latestConflicts }
}

function applyAcceptedPreference(
  members: NegotiationMember[],
  userId: string,
  preference: string,
  value: unknown,
): void {
  const member = members.find((item) => item.userProfile.userId === userId)
  if (!member) throw new NegotiationError('Target user is no longer in this family.', 409)
  const current = member.userTravelProfile[preference]
  if (!isRecord(current)) {
    member.userTravelProfile[preference] = { value }
  } else {
    current.value = value
  }
}

export async function respondToNegotiationRequest(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requestId: string
    responderUserId: string
    answer: 'accept' | 'reject'
    note: string | null
  },
): Promise<{
  request: NegotiationRequest
  conflicts: NegotiationConflict[]
}> {
  return withFamilyLock(env, input.source, input.familyCode, () =>
    respondToNegotiationRequestLocked(env, input),
  )
}

async function respondToNegotiationRequestLocked(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requestId: string
    responderUserId: string
    answer: 'accept' | 'reject'
    note: string | null
  },
): Promise<{
  request: NegotiationRequest
  conflicts: NegotiationConflict[]
}> {
  const family = await loadFamilyRecord(env, input.source, input.familyCode)
  requireFamilyMember(family, input.responderUserId)
  const request = family.state.requests.find((item) => item.requestId === input.requestId)
  if (!request) throw new NegotiationError('Negotiation request not found.', 404)
  if (request.familyCode !== input.familyCode) {
    throw new NegotiationError('Negotiation request does not belong to this family.', 404)
  }
  if (request.targetUserId !== input.responderUserId) {
    throw new NegotiationError('Only the requested user can answer this negotiation request.', 403)
  }
  if (negotiationLimits.nonNegotiable.has(request.preference)) {
    throw new NegotiationError(`${request.preference} is protected and cannot be changed.`, 409)
  }
  if (request.status !== 'pending') {
    throw new NegotiationError(`Request ${request.requestId} is already ${request.status}.`, 409)
  }

  request.status = input.answer === 'accept' ? 'accepted' : 'rejected'
  request.answeredAt = new Date().toISOString()
  request.responseNote = input.note
  if (input.answer === 'accept') {
    validateProposedPreference(request.preference, request.proposedValue)
    applyAcceptedPreference(
      family.members,
      request.targetUserId,
      request.preference,
      request.proposedValue,
    )
    family.state.negotiatedValues[request.targetUserId] ??= {}
    family.state.negotiatedValues[request.targetUserId][request.preference] =
      request.proposedValue
  }
  const conflicts = reconcileNegotiationState(family.members, family.state)
  await saveFamilyRecord(env, family)
  return { request, conflicts }
}

export async function automaticallyCreateNegotiationRequests(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requesterUserId: string
    triggerRequestId: string
  },
): Promise<{ created: string[]; stopped: boolean }> {
  let family = await loadFamilyRecord(env, input.source, input.familyCode)
  requireFamilyMember(family, input.requesterUserId)
  const conflicts = reconcileNegotiationState(family.members, family.state)
  const totalLimit = maxTotalNegotiationRequests(family.members)
  if (family.state.requests.length >= totalLimit && await stopAtRequestLimit(env, input)) {
    return { created: [], stopped: true }
  }

  const created: string[] = []
  for (const conflict of conflicts) {
    family = await loadFamilyRecord(env, input.source, input.familyCode)
    requireFamilyMember(family, input.requesterUserId)
    const activeConflicts = reconcileNegotiationState(family.members, family.state)
    if (family.state.requests.length >= totalLimit && await stopAtRequestLimit(env, input)) {
      return { created, stopped: true }
    }
    const currentConflict = activeConflicts.find(
      (item) => item.preference === conflict.preference,
    )
    if (!currentConflict) continue
    if (
      currentConflict.resolution !== 'negotiate' ||
      family.state.resolvedPreferences[currentConflict.preference] ||
      family.state.requests.some(
        (request) =>
          request.preference === currentConflict.preference && request.status === 'pending',
      ) ||
      Object.values(family.state.idempotency).some(
        (entry) =>
          entry.status === 'generating' && entry.preference === currentConflict.preference,
      )
    ) {
      continue
    }
    const idempotencyKey = `followup:${input.triggerRequestId}:${currentConflict.preference}`
    const result = await createNegotiationRequest(env, {
      source: input.source,
      familyCode: input.familyCode,
      requesterUserId: input.requesterUserId,
      preference: currentConflict.preference,
      idempotencyKey,
    })
    if (result.status === 'created') created.push(result.request.requestId)
  }
  return { created, stopped: false }
}

async function stopAtRequestLimit(
  env: Env,
  input: {
    source: NegotiationSource
    familyCode: string
    requesterUserId: string
    triggerRequestId: string
  },
): Promise<boolean> {
  return withFamilyLock(env, input.source, input.familyCode, async () => {
    const family = await loadFamilyRecord(env, input.source, input.familyCode)
    requireFamilyMember(family, input.requesterUserId)
    const totalLimit = maxTotalNegotiationRequests(family.members)
    if (family.state.requests.length < totalLimit) return false
    const conflicts = reconcileNegotiationState(family.members, family.state)
    for (const conflict of conflicts) {
      if (
        conflict.resolution === 'negotiate' &&
        !family.state.resolvedPreferences[conflict.preference]
      ) {
        family.state.resolvedPreferences[conflict.preference] = 'stopped_after_limit'
      }
    }
    await saveFamilyRecord(env, family)
    return true
  })
}
