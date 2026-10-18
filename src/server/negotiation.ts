import {
  GEMINI_INTERACTIONS_URL,
  GEMINI_MODEL_NAME,
  outputTextFromInteraction,
} from './gemini-interactions.js'

export interface NegotiationParticipant {
  userId: string
  name: string
  value: unknown
  priority: string
}

export interface NegotiationConflict {
  preference: string
  description: string
  priority: string
  users: NegotiationParticipant[]
  resolution: 'negotiate' | 'accommodate' | 'split' | 'review'
  gap: number | null
}

export interface NegotiationStatus {
  familyCode: string
  conflicts: NegotiationConflict[]
  requests: NegotiationRequest[]
  negotiatedValues: Record<string, Record<string, unknown>>
  resolvedPreferences: Record<string, string>
  balanced: boolean
  questionLimitReached: boolean
  sessionStatus: NegotiationSessionStatus
  sessionId: string | null
  sessionQuestionCount: number
  sessionQuestionLimit: number
}

export type NegotiationSessionStatus =
  | 'awaiting_consent'
  | 'active'
  | 'completed'
  | 'limit_reached'

export interface NegotiationSession {
  id: string
  status: Exclude<NegotiationSessionStatus, 'awaiting_consent'>
  startedAt: string
}

export interface NegotiationRequest {
  requestId: string
  familyCode: string
  requesterUserId: string
  targetUserId: string
  targetName: string
  preference: string
  currentValue: unknown
  proposedValue: unknown
  question: string
  rationale: string
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  createdAt: string
  answeredAt?: string
  responseNote?: string | null
  attempt: number
  sessionId?: string
}

export interface NegotiationState {
  requests: NegotiationRequest[]
  negotiatedValues: Record<string, Record<string, unknown>>
  resolvedPreferences: Record<string, string>
  session?: NegotiationSession | null
  idempotency: Record<
    string,
    {
      requestId: string
      status: 'generating' | 'completed'
      updatedAt: string
      preference: string
      targetUserId?: string
      requesterUserId: string
      sessionId?: string
    }
  >
}

export interface NegotiationMember {
  userProfile: { userId: string; name: string; [key: string]: unknown }
  userTravelProfile: Record<string, unknown>
  [key: string]: unknown
}

export class NegotiationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 502 | 503,
  ) {
    super(message)
    this.name = 'NegotiationError'
  }
}

const GEMINI_TIMEOUT_MS = 20_000
const MAX_REQUESTS_PER_PREFERENCE = 2
const BASE_TOTAL_REQUESTS = 4
const REQUESTS_PER_FAMILY_MEMBER = 4
const QUESTIONS_PER_FAMILY_MEMBER = 4
const NON_NEGOTIABLE = new Set(['dietaryRestrictions', 'luggagePreference'])
const NUMERIC_THRESHOLDS: Record<string, number> = {
  tripPace: 0.2,
  travelStyle: 0.2,
  activityPopularity: 0.3,
}
const PREFERENCE_GUIDANCE: Record<string, string> = {
  tripPace: 'How densely activities are scheduled, from relaxed (0) to fast-paced (1).',
  travelStyle: 'How exploratory the itinerary is, from relaxed (0) to exploratory (1).',
  activityPopularity: 'Preference for less popular (0) versus very popular (1) attractions.',
  budgetTier:
    'Budget level: 1 low, 2 medium, 3 high. Discuss cost tradeoffs instead of averaging blindly.',
  morningRoutine: 'Preferred start: early, midway, or late.',
  interestedInShopping: 'Whether the traveler wants shopping included.',
}

type GeminiAction = {
  action: 'ask_user' | 'recommend_split' | 'accommodate' | 'review'
  target_participant?: string | null
  target_user_id?: string | null
  proposed_value?: unknown
  question?: string | null
  rationale: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function emptyNegotiationState(): NegotiationState {
  return {
    requests: [],
    negotiatedValues: {},
    resolvedPreferences: {},
    idempotency: {},
    session: null,
  }
}

export function parseNegotiationState(value: unknown): NegotiationState {
  if (value === undefined) return emptyNegotiationState()
  if (
    !isRecord(value) ||
    !Array.isArray(value.requests) ||
    !isRecord(value.negotiatedValues) ||
    !isRecord(value.resolvedPreferences) ||
    (value.idempotency !== undefined && !isRecord(value.idempotency))
  ) {
    throw new Error('Stored negotiation state is invalid.')
  }
  const requests = value.requests
  for (const request of requests) {
    if (
      !isRecord(request) ||
      typeof request.requestId !== 'string' ||
      typeof request.familyCode !== 'string' ||
      typeof request.requesterUserId !== 'string' ||
      typeof request.targetUserId !== 'string' ||
      typeof request.preference !== 'string' ||
      typeof request.targetName !== 'string' ||
      typeof request.question !== 'string' ||
      typeof request.rationale !== 'string' ||
      typeof request.createdAt !== 'string' ||
      typeof request.attempt !== 'number' ||
      !Number.isInteger(request.attempt) ||
      request.attempt < 1 ||
      (request.sessionId !== undefined && typeof request.sessionId !== 'string') ||
      !['pending', 'accepted', 'rejected', 'superseded'].includes(String(request.status))
    ) {
      throw new Error('Stored negotiation state contains an invalid request.')
    }
  }
  if (
    Object.values(value.negotiatedValues).some((entry) => !isRecord(entry)) ||
    Object.values(value.resolvedPreferences).some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('Stored negotiation state contains invalid resolution data.')
  }
  const idempotency = value.idempotency ?? {}
  for (const entry of Object.values(idempotency)) {
    if (
      !isRecord(entry) ||
      typeof entry.requestId !== 'string' ||
      typeof entry.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.updatedAt)) ||
      typeof entry.preference !== 'string' ||
      typeof entry.requesterUserId !== 'string' ||
      !['generating', 'completed'].includes(String(entry.status)) ||
      (entry.targetUserId !== undefined && typeof entry.targetUserId !== 'string') ||
      (entry.sessionId !== undefined && typeof entry.sessionId !== 'string')
    ) {
      throw new Error('Stored negotiation state contains an invalid idempotency entry.')
    }
  }
  const session = value.session
  if (
    session !== undefined &&
    session !== null &&
    (!isRecord(session) ||
      typeof session.id !== 'string' ||
      typeof session.startedAt !== 'string' ||
      !['active', 'completed', 'limit_reached'].includes(String(session.status)))
  ) {
    throw new Error('Stored negotiation state contains an invalid session.')
  }
  return {
    requests: requests as NegotiationRequest[],
    negotiatedValues: value.negotiatedValues as Record<string, Record<string, unknown>>,
    resolvedPreferences: value.resolvedPreferences as Record<string, string>,
    idempotency: idempotency as NegotiationState['idempotency'],
    session: (session ?? null) as NegotiationSession | null,
  }
}

export function parseNegotiationMembers(value: unknown): NegotiationMember[] {
  if (!Array.isArray(value)) throw new Error('Family record must contain a users array.')
  const members: NegotiationMember[] = value.map((rawMember) => {
    if (!isRecord(rawMember) || !isRecord(rawMember.userProfile)) {
      throw new Error('Every family member must have a userProfile object.')
    }
    const profile = rawMember.userProfile
    if (
      typeof profile.userId !== 'string' ||
      !profile.userId ||
      typeof profile.name !== 'string' ||
      !profile.name ||
      !isRecord(rawMember.userTravelProfile)
    ) {
      throw new Error('Every family member must have an ID, name, and travel profile.')
    }
    return {
      ...rawMember,
      userProfile: { ...profile, userId: profile.userId, name: profile.name },
      userTravelProfile: rawMember.userTravelProfile,
    }
  })
  if (members.length === 0) throw new Error('The family must contain at least one user.')
  return members
}

function preferenceEntries(
  members: NegotiationMember[],
  key: string,
): NegotiationParticipant[] {
  const entries: NegotiationParticipant[] = []
  for (const member of members) {
    const rawPreference = member.userTravelProfile[key]
    if (!isRecord(rawPreference) || !Object.hasOwn(rawPreference, 'value')) continue
    entries.push({
      userId: member.userProfile.userId,
      name: member.userProfile.name,
      value: rawPreference.value,
      priority: typeof rawPreference.priority === 'string' ? rawPreference.priority : 'flexible',
    })
  }
  return entries
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

export function detectNegotiationConflicts(
  members: NegotiationMember[],
): NegotiationConflict[] {
  const keys = [...new Set(members.flatMap((member) => Object.keys(member.userTravelProfile)))].sort()
  const conflicts: NegotiationConflict[] = []
  for (const key of keys) {
    const users = preferenceEntries(members, key)
    const values = users.map((entry) => entry.value)
    if (users.length < 2 || new Set(values.map(canonicalJson)).size < 2) continue

    const priority = users.some((entry) => entry.priority === 'critical')
      ? 'critical'
      : users[0].priority
    let gap: number | null = null
    let resolution: NegotiationConflict['resolution'] = 'review'
    if (NON_NEGOTIABLE.has(key)) {
      resolution = 'accommodate'
    } else if (
      values.every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      const numericValues = values as number[]
      gap = Math.max(...numericValues) - Math.min(...numericValues)
      resolution = gap > (NUMERIC_THRESHOLDS[key] ?? 0) ? 'negotiate' : 'accommodate'
    } else if (key === 'morningRoutine' || key === 'interestedInShopping') {
      resolution = 'split'
    } else if (priority !== 'critical') {
      resolution = 'negotiate'
    }
    conflicts.push({
      preference: key,
      description: PREFERENCE_GUIDANCE[key] ?? 'Conflicting family preference.',
      priority,
      users,
      resolution,
      gap,
    })
  }
  return conflicts
}

export function maxTotalNegotiationRequests(members: NegotiationMember[]): number {
  return BASE_TOTAL_REQUESTS + REQUESTS_PER_FAMILY_MEMBER * members.length
}

export function maxTotalNegotiationQuestions(members: NegotiationMember[]): number {
  return BASE_TOTAL_REQUESTS + QUESTIONS_PER_FAMILY_MEMBER * members.length
}

export function hasAskedPreferenceOfUser(
  state: NegotiationState,
  preference: string,
  targetUserId: string,
  excludeRequestId?: string,
): boolean {
  return (
    state.requests.some(
      (request) =>
        request.preference === preference &&
        request.targetUserId === targetUserId &&
        request.requestId !== excludeRequestId,
    ) ||
    Object.values(state.idempotency).some(
      (entry) =>
        entry.preference === preference &&
        entry.requestId !== excludeRequestId &&
        entry.targetUserId === targetUserId,
    )
  )
}

export function hasUnaskedNegotiationTarget(
  conflicts: NegotiationConflict[],
  state: NegotiationState,
): boolean {
  return conflicts.some((conflict) => {
    if (conflict.resolution !== 'negotiate' || state.resolvedPreferences[conflict.preference]) {
      return false
    }
    return conflict.users.some(
      (target) => !hasAskedPreferenceOfUser(state, conflict.preference, target.userId),
    )
  })
}

export function reconcileNegotiationState(
  members: NegotiationMember[],
  state: NegotiationState,
): NegotiationConflict[] {
  const conflicts = detectNegotiationConflicts(members)
  const activePreferences = new Set(conflicts.map((conflict) => conflict.preference))
  for (const preference of Object.keys(state.resolvedPreferences)) {
    if (!activePreferences.has(preference)) delete state.resolvedPreferences[preference]
  }
  for (const request of state.requests) {
    if (request.status === 'pending' && !activePreferences.has(request.preference)) {
      request.status = 'superseded'
    }
  }
  for (const conflict of conflicts) {
    const attempts = state.requests.filter(
      (request) => request.preference === conflict.preference,
    )
    if (conflict.resolution === 'accommodate') {
      state.resolvedPreferences[conflict.preference] = 'accommodate'
    } else if (conflict.resolution === 'split') {
      state.resolvedPreferences[conflict.preference] = 'split'
    } else if (
      attempts.length >= MAX_REQUESTS_PER_PREFERENCE &&
      !attempts.some((request) => request.status === 'pending')
    ) {
      state.resolvedPreferences[conflict.preference] = 'stopped_after_limit'
    }
  }
  return conflicts
}

export function validateProposedPreference(preference: string, value: unknown): void {
  if (preference === 'tripPace' || preference === 'travelStyle' || preference === 'activityPopularity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      const label =
        preference === 'tripPace'
          ? 'Daily pace'
          : preference === 'travelStyle'
            ? 'Travel style'
            : 'Attraction popularity'
      throw new NegotiationError(`${label} must be between the lowest and highest settings.`, 502)
    }
  } else if (preference === 'budgetTier' && value !== 1 && value !== 2 && value !== 3) {
    throw new NegotiationError('Budget must be set to a low, moderate, or high level.', 502)
  }
}

function isGeminiAction(value: unknown): value is GeminiAction {
  return (
    isRecord(value) &&
    ['ask_user', 'recommend_split', 'accommodate', 'review'].includes(String(value.action)) &&
    typeof value.rationale === 'string' &&
    (value.target_participant === undefined ||
      value.target_participant === null ||
      typeof value.target_participant === 'string') &&
    (value.target_user_id === undefined ||
      value.target_user_id === null ||
      typeof value.target_user_id === 'string')
  )
}

export async function askGeminiForNegotiation(
  conflict: NegotiationConflict,
  targetUserId: string | undefined,
  apiKey: string,
): Promise<GeminiAction & { targetUserId?: string }> {
  const participants = conflict.users.map((entry, index) => ({
    participant: `traveler_${index + 1}`,
    value: entry.value,
    priority: entry.priority,
  }))
  const targetParticipant = targetUserId
    ? conflict.users.findIndex((entry) => entry.userId === targetUserId) + 1
    : 0
  const prompt = {
    role: 'You are a neutral travel-preference negotiator.',
    rules: [
      'Never negotiate away dietary restrictions or luggage requirements.',
      'Ask one specific user one neutral, voluntary question at a time.',
      'For budget tiers, discuss a concrete cost compromise instead of averaging numbers.',
      'Recommend a split when preferences cannot reasonably be combined.',
      'Never claim a user agreed before a response is recorded.',
      'When selecting a participant, return its traveler_N label in target_participant; never invent a real user ID.',
    ],
    conflict: {
      preference: conflict.preference,
      description: conflict.description,
      priority: conflict.priority,
      gap: conflict.gap,
      participants,
    },
    requested_target: targetParticipant ? `traveler_${targetParticipant}` : null,
    output: 'Return one structured negotiation action.',
  }
  let response: Response
  try {
    response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify({
        model: GEMINI_MODEL_NAME,
        input: JSON.stringify(prompt),
        generation_config: { thinking_level: 'low' },
        background: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['ask_user', 'recommend_split', 'accommodate', 'review'] },
              target_participant: {
                type: ['string', 'null'],
                description: 'Use the requested traveler_N for ask_user; otherwise null.',
              },
              target_user_id: {
                type: ['string', 'null'],
                description: 'Always null; real user IDs are resolved by the server.',
              },
              proposed_value: {
                description: 'Required for ask_user; use null for other actions.',
              },
              question: {
                type: ['string', 'null'],
                description: 'A specific, voluntary question for ask_user; otherwise null.',
              },
              rationale: { type: 'string' },
            },
            required: [
              'action',
              'target_participant',
              'target_user_id',
              'proposed_value',
              'question',
              'rationale',
            ],
            additionalProperties: false,
          },
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('Gemini negotiation request failed.', error)
    throw new NegotiationError('Gemini could not generate a negotiation action.', 502)
  }
  if (!response.ok) {
    console.error(`Gemini negotiation request failed with HTTP ${response.status}.`)
    throw new NegotiationError('Gemini could not generate a negotiation action.', 502)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    console.error('Gemini negotiation request returned invalid JSON.', error)
    throw new NegotiationError('Gemini returned an invalid response.', 502)
  }
  if (!isRecord(payload)) throw new NegotiationError('Gemini returned an invalid response.', 502)
  const outputText = outputTextFromInteraction(payload)
  if (!outputText.trim()) {
    throw new NegotiationError('Gemini returned an empty negotiation action.', 502)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(outputText)
  } catch (error) {
    console.error('Gemini returned invalid negotiation JSON.', error)
    throw new NegotiationError('Gemini returned an invalid negotiation action.', 502)
  }
  if (!isGeminiAction(decoded)) {
    throw new NegotiationError('Gemini returned an invalid negotiation action.', 502)
  }
  if (
    decoded.action === 'ask_user' &&
    (!decoded.question?.trim() ||
      decoded.proposed_value === undefined ||
      decoded.proposed_value === null)
  ) {
    throw new NegotiationError(
      'Gemini selected ask_user but omitted the question or proposed value.',
      502,
    )
  }
  let resolvedTargetId: string | undefined
  if (decoded.target_participant) {
    const match = /^traveler_(\d+)$/u.exec(decoded.target_participant)
    const index = match ? Number(match[1]) - 1 : -1
    resolvedTargetId = conflict.users[index]?.userId
    if (!resolvedTargetId) {
      throw new NegotiationError('Gemini selected an unknown family member.', 502)
    }
  }
  if (targetUserId && resolvedTargetId && resolvedTargetId !== targetUserId) {
    throw new NegotiationError('Gemini selected a different target than requested.', 502)
  }
  if (targetUserId && decoded.target_user_id && decoded.target_user_id !== targetUserId) {
    throw new NegotiationError('Gemini selected a different target than requested.', 502)
  }
  if (decoded.target_user_id && !conflict.users.some((user) => user.userId === decoded.target_user_id)) {
    throw new NegotiationError('Gemini selected a user outside the family conflict.', 502)
  }
  return { ...decoded, targetUserId: resolvedTargetId ?? decoded.target_user_id ?? targetUserId }
}

export const negotiationLimits = {
  maxRequestsPerPreference: MAX_REQUESTS_PER_PREFERENCE,
  nonNegotiable: NON_NEGOTIABLE,
}
