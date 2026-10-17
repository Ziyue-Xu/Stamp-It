export interface UserPreference {
  userProfile: {
    userId: string
    name: string
    email: string
  }
  userTravelProfile: Record<string, unknown>
}

export interface FamilyRecord {
  familyCode: string
  users: UserPreference[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseUserPreference(value: unknown): UserPreference | null {
  if (!isObject(value)) return null

  const profile = value.userProfile
  const travelProfile = value.userTravelProfile
  if (
    !isObject(profile) ||
    typeof profile.userId !== 'string' ||
    !profile.userId.trim() ||
    typeof profile.name !== 'string' ||
    typeof profile.email !== 'string' ||
    !isObject(travelProfile)
  ) {
    return null
  }

  return {
    ...value,
    userProfile: {
      ...profile,
      userId: profile.userId,
      name: profile.name,
      email: profile.email,
    },
    userTravelProfile: travelProfile,
  }
}

export function upsertUserPreference(
  users: UserPreference[],
  preference: UserPreference,
): UserPreference[] {
  const byUserId = new Map(users.map((user) => [user.userProfile.userId, user]))
  byUserId.set(preference.userProfile.userId, preference)
  return Array.from(byUserId.values())
}
