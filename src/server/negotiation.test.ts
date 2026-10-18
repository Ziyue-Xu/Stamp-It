import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askGeminiForNegotiation,
  detectNegotiationConflicts,
  emptyNegotiationState,
  hasAskedPreferenceOfUser,
  hasUnaskedNegotiationTarget,
  maxTotalNegotiationQuestions,
  parseNegotiationMembers,
  parseNegotiationState,
  reconcileNegotiationState,
  validateProposedPreference,
} from './negotiation.js'
import type { NegotiationMember } from './negotiation.js'

function member(
  userId: string,
  preferences: Record<string, unknown>,
): NegotiationMember {
  return {
    userProfile: { userId, name: userId },
    userTravelProfile: preferences,
  }
}

describe('travel preference negotiation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('classifies numeric, non-negotiable, and split conflicts', () => {
    const conflicts = detectNegotiationConflicts([
      member('u1', {
        tripPace: { value: 0.1, priority: 'flexible' },
        dietaryRestrictions: { value: ['vegan'], priority: 'weak_link' },
        morningRoutine: { value: 'early', priority: 'critical' },
        activityPopularity: { value: 0.2, priority: 'flexible' },
      }),
      member('u2', {
        tripPace: { value: 0.8, priority: 'flexible' },
        dietaryRestrictions: { value: ['none'], priority: 'weak_link' },
        morningRoutine: { value: 'late', priority: 'critical' },
        activityPopularity: { value: 0.4, priority: 'flexible' },
      }),
    ])

    const byPreference = new Map(conflicts.map((conflict) => [conflict.preference, conflict]))
    expect(byPreference.get('tripPace')?.resolution).toBe('negotiate')
    expect(byPreference.get('tripPace')?.gap).toBeCloseTo(0.7)
    expect(byPreference.get('dietaryRestrictions')).toMatchObject({
      resolution: 'accommodate',
      priority: 'weak_link',
    })
    expect(byPreference.get('morningRoutine')?.resolution).toBe('split')
    expect(byPreference.get('activityPopularity')).toMatchObject({
      resolution: 'accommodate',
      gap: 0.2,
    })
  })

  it('does not balance fixed two-option preferences', () => {
    const conflicts = detectNegotiationConflicts([
      member('u1', {
        diningCuisine: { value: 'local', priority: 'flexible' },
        interestedInShopping: { value: true, priority: 'flexible' },
        luggagePreference: { value: 'backpacking', priority: 'critical' },
        petFriendly: { value: true, priority: 'weak_link' },
        tourPreference: { value: 'guided', priority: 'flexible' },
      }),
      member('u2', {
        diningCuisine: { value: 'casual', priority: 'flexible' },
        interestedInShopping: { value: false, priority: 'flexible' },
        luggagePreference: { value: 'suitcases', priority: 'critical' },
        petFriendly: { value: false, priority: 'weak_link' },
        tourPreference: { value: 'self-guided', priority: 'flexible' },
      }),
    ])

    expect(conflicts).toEqual([])
  })

  it('ignores null preference values while detecting conflicts', () => {
    expect(
      detectNegotiationConflicts([
        member('u1', { tripPace: { value: null, priority: 'flexible' } }),
        member('u2', { tripPace: { value: 0.9, priority: 'flexible' } }),
      ]),
    ).toEqual([])

    expect(
      detectNegotiationConflicts([
        member('u1', { tripPace: { value: 0.1, priority: 'flexible' } }),
        member('u2', { tripPace: { value: null, priority: 'flexible' } }),
        member('u3', { tripPace: { value: 0.9, priority: 'flexible' } }),
      ])[0]?.users.map((user) => user.userId),
    ).toEqual(['u1', 'u3'])
  })

  it('records a preference question once per target traveler', () => {
    const state = emptyNegotiationState()
    state.requests.push({
      requestId: 'request-1',
      familyCode: '1234',
      requesterUserId: 'u1',
      targetUserId: 'u2',
      targetName: 'u2',
      preference: 'tripPace',
      currentValue: 0.1,
      proposedValue: 0.5,
      question: 'Would you consider a compromise?',
      rationale: 'Balance the group preference.',
      status: 'rejected',
      createdAt: '2026-01-01T00:00:00.000Z',
      attempt: 1,
      sessionId: 'previous-session',
    })

    state.session = {
      id: 'new-session',
      status: 'active',
      startedAt: '2026-02-01T00:00:00.000Z',
    }
    expect(hasAskedPreferenceOfUser(state, 'tripPace', 'u2')).toBe(true)
    expect(hasAskedPreferenceOfUser(state, 'tripPace', 'u3')).toBe(false)
    expect(hasAskedPreferenceOfUser(state, 'travelStyle', 'u2')).toBe(false)

    const conflicts = detectNegotiationConflicts([
      member('u1', { tripPace: { value: 0.1, priority: 'flexible' } }),
      member('u2', { tripPace: { value: 0.5, priority: 'flexible' } }),
      member('u3', { tripPace: { value: 0.9, priority: 'flexible' } }),
    ])
    expect(hasUnaskedNegotiationTarget(conflicts, state)).toBe(true)
    state.requests.push({
      requestId: 'request-2',
      familyCode: '1234',
      requesterUserId: 'u1',
      targetUserId: 'u3',
      targetName: 'u3',
      preference: 'tripPace',
      currentValue: 0.1,
      proposedValue: 0.5,
      question: 'Would you consider a compromise?',
      rationale: 'Balance the group preference.',
      status: 'rejected',
      createdAt: '2026-01-01T00:00:00.000Z',
      attempt: 1,
    })
    expect(hasUnaskedNegotiationTarget(conflicts, state)).toBe(true)
    state.requests.push({
      requestId: 'request-3',
      familyCode: '1234',
      requesterUserId: 'u2',
      targetUserId: 'u1',
      targetName: 'u1',
      preference: 'tripPace',
      currentValue: 0.5,
      proposedValue: 0.3,
      question: 'Would you consider a compromise?',
      rationale: 'Balance the group preference.',
      status: 'rejected',
      createdAt: '2026-01-01T00:00:00.000Z',
      attempt: 1,
    })
    expect(hasUnaskedNegotiationTarget(conflicts, state)).toBe(false)
  })

  it('caps total questions at four plus four per family member', () => {
    expect(maxTotalNegotiationQuestions([member('u1', {})])).toBe(8)
    expect(
      maxTotalNegotiationQuestions([
        member('u1', {}),
        member('u2', {}),
        member('u3', {}),
      ]),
    ).toBe(16)
  })

  it('does not suppress later unasked pairs for a preference', () => {
    const state = emptyNegotiationState()
    state.requests.push(
      ...[
        ['tripPace', 'rejected'],
        ['travelStyle', 'accepted'],
        ['activityPopularity', 'superseded'],
      ].map(([preference, status], index) => ({
        requestId: `request-${index}`,
        familyCode: '1234',
        requesterUserId: 'u1',
        targetUserId: 'u2',
        targetName: 'u2',
        preference,
        currentValue: 0.1,
        proposedValue: 0.5,
        question: 'Would you consider a compromise?',
        rationale: 'Balance the group preference.',
        status: status as 'rejected' | 'accepted' | 'superseded',
        createdAt: '2026-01-01T00:00:00.000Z',
        attempt: 1,
      })),
    )

    reconcileNegotiationState(
      [
        member('u1', {
          tripPace: { value: 0.1, priority: 'flexible' },
          travelStyle: { value: 0.1, priority: 'flexible' },
          activityPopularity: { value: 0.1, priority: 'flexible' },
        }),
        member('u2', {
          tripPace: { value: 0.9, priority: 'flexible' },
          travelStyle: { value: 0.9, priority: 'flexible' },
          activityPopularity: { value: 0.9, priority: 'flexible' },
        }),
      ],
      state,
    )

    expect(state.resolvedPreferences).toEqual({})
  })

  it('does not report equal or single-member values as conflicts', () => {
    expect(
      detectNegotiationConflicts([
        member('u1', { tripPace: { value: 0.5, priority: 'flexible' } }),
        member('u2', { tripPace: { value: 0.5, priority: 'flexible' } }),
      ]),
    ).toEqual([])
    expect(
      detectNegotiationConflicts([
        member('u1', { tripPace: { value: 0.5, priority: 'flexible' } }),
      ]),
    ).toEqual([])
  })

  it('supersedes pending requests when a conflict disappears', () => {
    const state = emptyNegotiationState()
    state.requests.push({
      requestId: 'request-1',
      familyCode: '1234',
      requesterUserId: 'u1',
      targetUserId: 'u2',
      targetName: 'u2',
      preference: 'tripPace',
      currentValue: 0.9,
      proposedValue: 0.1,
      question: 'Would you try a slower pace?',
      rationale: 'The group is split.',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      attempt: 1,
    })
    state.resolvedPreferences.tripPace = 'stopped_after_limit'

    const conflicts = reconcileNegotiationState(
      [
        member('u1', { tripPace: { value: 0.2, priority: 'flexible' } }),
        member('u2', { tripPace: { value: 0.2, priority: 'flexible' } }),
      ],
      state,
    )

    expect(conflicts).toEqual([])
    expect(state.requests[0].status).toBe('superseded')
    expect(state.resolvedPreferences).toEqual({})
  })

  it('rejects malformed family and negotiation records', () => {
    expect(() => parseNegotiationMembers([{ userProfile: { userId: 'u1' } }])).toThrow(
      'Every family member must have an ID, name, and travel profile.',
    )
    expect(() => parseNegotiationState({ requests: [], negotiatedValues: [] })).toThrow(
      'Stored negotiation state is invalid.',
    )
  })

  it('validates Gemini proposals for preference-specific numeric bounds', () => {
    expect(() => validateProposedPreference('tripPace', 1)).not.toThrow()
    expect(() => validateProposedPreference('budgetTier', 2)).not.toThrow()
    expect(() => validateProposedPreference('tripPace', true)).toThrow(
      'tripPace must be a number between 0 and 1.',
    )
    expect(() => validateProposedPreference('budgetTier', 4)).toThrow(
      'budgetTier must be 1, 2, or 3.',
    )
  })

  it('maps model-selected participants to family IDs and enforces a requested target', async () => {
    const conflict = detectNegotiationConflicts([
      member('u1', { tripPace: { value: 0.1, priority: 'flexible' } }),
      member('u2', { tripPace: { value: 0.9, priority: 'flexible' } }),
    ])[0]
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({
        output_text: JSON.stringify({
          action: 'ask_user',
          target_participant: 'traveler_2',
          target_user_id: null,
          proposed_value: 0.1,
          question: 'Would you consider a more relaxed pace?',
          rationale: 'This compromise aligns with the other traveler.',
        }),
      })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await askGeminiForNegotiation(conflict, 'u2', 'server-only-key')

    expect(result.targetUserId).toBe('u2')
    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('server-only-key')
    const requestBody = JSON.parse(init.body)
    expect(requestBody.input).toContain('traveler_2')
    expect(requestBody.response_format.schema.required).toEqual([
      'action',
      'target_participant',
      'target_user_id',
      'proposed_value',
      'question',
      'rationale',
    ])

    await expect(askGeminiForNegotiation(conflict, 'u1', 'server-only-key')).rejects.toThrow(
      'Gemini selected a different target than requested.',
    )
  })

  it('rejects ask_user responses without a question or proposed value', async () => {
    const conflict = detectNegotiationConflicts([
      member('u1', { tripPace: { value: 0.1, priority: 'flexible' } }),
      member('u2', { tripPace: { value: 0.9, priority: 'flexible' } }),
    ])[0]
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          action: 'ask_user',
          target_participant: 'traveler_2',
          target_user_id: null,
          proposed_value: null,
          question: null,
          rationale: 'This compromise aligns with the other traveler.',
        }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      askGeminiForNegotiation(conflict, 'u2', 'server-only-key'),
    ).rejects.toThrow(
      'Gemini selected ask_user but omitted the question or proposed value.',
    )
  })
})
