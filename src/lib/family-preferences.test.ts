import { describe, expect, it } from 'vitest'
import {
  parseUserPreference,
  upsertUserPreference,
  type UserPreference,
} from './family-preferences'

function preference(userId: string, name = userId): UserPreference {
  return {
    userProfile: { userId, name, email: `${userId}@example.com` },
    userTravelProfile: { tripPace: { value: 0.5, priority: 'flexible' } },
  }
}

describe('family preference helpers', () => {
  it('accepts user preference JSON with profile and travel preferences', () => {
    expect(parseUserPreference(preference('user-1'))).toEqual(preference('user-1'))
  })

  it('rejects malformed preference JSON', () => {
    expect(parseUserPreference(null)).toBeNull()
    expect(parseUserPreference({ userProfile: { userId: 'user-1' } })).toBeNull()
  })

  it('adds a new user or replaces only that user preference', () => {
    const first = preference('user-1')
    const second = preference('user-2')
    const updatedFirst = preference('user-1', 'Updated name')

    expect(upsertUserPreference([first], second)).toEqual([first, second])
    expect(upsertUserPreference([first, second], updatedFirst)).toEqual([
      updatedFirst,
      second,
    ])
  })

  it('deduplicates existing entries with the same user id', () => {
    const oldPreference = preference('user-1', 'Old')
    const latestPreference = preference('user-1', 'Latest')

    expect(
      upsertUserPreference([oldPreference, latestPreference], preference('user-2')),
    ).toEqual([latestPreference, preference('user-2')])
  })
})
