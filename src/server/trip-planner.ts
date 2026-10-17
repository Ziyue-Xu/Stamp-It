const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MODEL_NAME = 'gemini-3.8-flash'
const REQUEST_TIMEOUT_MS = 30_000

const generationPrompt = `You are an AI travel planner that creates comprehensive group travel plans from a JSON object of traveler preferences, country, and trip details.

Preference priority:
- critical: strictly follow a specific value. If the value is a WARNING about conflicting preferences, find a compromise and explain it in warnings.
- flexible: balance the group's preferences and give extra weight to preferences that appear more often.
- weak_link: accommodate minority preferences, especially dietary needs, but do not add them to warnings.

Consider all provided preference fields, including groundTransportation, dietaryRestrictions, diningCuisine, tripPace (0 is slow, 1 is fast), activityFocus, activityPopularity, budgetTier (1 is low, 2 is medium, 3 is high), morningRoutine (early 6-8, midway 8-10, late 10-12), interestedInShopping, travelStyle (0 is relaxed, 1 is explorative), tourPreference, luggagePreference, and petFriendly.

Itinerary requirements:
- Use the provided start and end dates in YYYY-MM-DD format, and begin/end in the provided start/end cities.
- Suggest a reasonable number of destinations for the trip duration and pace. Return one linear itinerary; do not create splits or multiple options in one time slot.
- Include lodging for every night. Include transit whenever the group changes location, unless the next activity is in the same location. Choose realistic routes and travel times.
- Use distinct, well-rated meal venues where practical, with options for every dietary restriction.
- Keep activity duration and daily pace realistic; round durations to the nearest 5 minutes.
- Use Google Maps grounding to verify venues, addresses, distances, travel times, and opening hours. Avoid places too far from the previous activity and do not invent precise addresses.
- Consider seasonal availability, holidays, local events, and venue opening and closing times.
- On the final day, schedule broad travel to the provided end city/location, allowing appropriate travel time; do not invent a specific departure location.
- Explain preference conflicts or useful caveats as helpful warnings, not errors. If no warning is present for a critical preference, assume all travelers share it.

Return only the structured JSON itinerary matching the supplied response schema.`

const locationSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    address: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['name', 'address'],
  propertyOrdering: ['name', 'address'],
}

const itinerarySchema = {
  type: 'object',
  properties: {
    trip_title: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    destinations: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day_number: { type: 'integer' },
          date: { type: 'string' },
          base_city: { type: 'string' },
          day_theme_or_summary: { type: 'string' },
          timeline: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                item_type: { type: 'string', enum: ['lodging', 'activity', 'meal', 'transit'] },
                title: { type: 'string' },
                start_time: { type: 'string' },
                end_time: { type: 'string' },
                duration_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                location: { anyOf: [locationSchema, { type: 'null' }] },
                transit_details: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        mode: {
                          type: 'string',
                          enum: [
                            'flight',
                            'train',
                            'subway',
                            'bus',
                            'taxi',
                            'rideshare',
                            'walking',
                            'rental_car',
                            'ferry',
                          ],
                        },
                        provider_or_line: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        route_number: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        distance_km: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                      },
                      required: ['mode', 'provider_or_line', 'route_number', 'distance_km'],
                      propertyOrdering: ['mode', 'provider_or_line', 'route_number', 'distance_km'],
                    },
                    { type: 'null' },
                  ],
                },
                estimated_cost: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        amount: { type: 'number' },
                        currency: { type: 'string' },
                        is_per_person: { type: 'boolean' },
                      },
                      required: ['amount', 'currency', 'is_per_person'],
                      propertyOrdering: ['amount', 'currency', 'is_per_person'],
                    },
                    { type: 'null' },
                  ],
                },
                notes_and_tips: {
                  anyOf: [
                    { type: 'array', items: { type: 'string' } },
                    { type: 'null' },
                  ],
                },
              },
              required: [
                'id',
                'item_type',
                'title',
                'start_time',
                'end_time',
                'duration_minutes',
                'location',
                'transit_details',
                'estimated_cost',
                'notes_and_tips',
              ],
              propertyOrdering: [
                'id',
                'item_type',
                'title',
                'start_time',
                'end_time',
                'duration_minutes',
                'location',
                'transit_details',
                'estimated_cost',
                'notes_and_tips',
              ],
            },
          },
        },
        required: ['day_number', 'date', 'base_city', 'day_theme_or_summary', 'timeline'],
        propertyOrdering: ['day_number', 'date', 'base_city', 'day_theme_or_summary', 'timeline'],
      },
    },
  },
  required: ['trip_title', 'start_date', 'end_date', 'destinations', 'warnings', 'days'],
  propertyOrdering: ['trip_title', 'start_date', 'end_date', 'destinations', 'warnings', 'days'],
} as const

interface TravelerPreference {
  userProfile?: {
    userId?: string
    name?: string
  }
  userTravelProfile?: Record<string, unknown>
}

interface FamilyPreferences {
  users: TravelerPreference[]
  country?: string
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  startCity?: string
  endCity?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function outputTextFromInteraction(interaction: Record<string, unknown>): string {
  if (typeof interaction.output_text === 'string') return interaction.output_text
  if (!Array.isArray(interaction.steps)) return ''

  const textParts: string[] = []
  let collecting = false
  for (let i = interaction.steps.length - 1; i >= 0; i -= 1) {
    const step = interaction.steps[i]
    if (!isRecord(step)) continue
    if (step.type === 'user_input') break
    if (step.type === 'thought') continue
    if (step.type !== 'model_output') {
      if (collecting) break
      continue
    }
    if (!Array.isArray(step.content)) continue
    for (let j = step.content.length - 1; j >= 0; j -= 1) {
      const content = step.content[j]
      if (!isRecord(content)) continue
      if (content.type === 'text') {
        collecting = true
        textParts.push(typeof content.text === 'string' ? content.text : '')
      } else if (collecting) {
        return textParts.reverse().join('')
      }
    }
  }
  return textParts.reverse().join('')
}

function normalizeTripDateTime(value: string): { date: string; time: string } {
  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?$/iu.exec(value.trim())
  if (usDate) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = usDate
    const month = Number(monthText)
    const day = Number(dayText)
    const year = Number(yearText)
    const parsedDate = new Date(Date.UTC(year, month - 1, day))
    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      throw new Error('Trip dates are invalid.')
    }
    let time = ''
    if (hourText && minuteText && meridiem) {
      const hour = Number(hourText)
      const minute = Number(minuteText)
      if (hour < 1 || hour > 12 || minute > 59) throw new Error('Trip times are invalid.')
      const hour24 = (hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
      time = `${String(hour24).padStart(2, '0')}:${minuteText}`
    }
    return {
      date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time,
    }
  }

  const isoDateTime = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.exec(
    value.trim(),
  )
  if (!isoDateTime) throw new Error('Trip dates must use a supported date format.')
  const [, yearText, monthText, dayText, hourText, minuteText] = isoDateTime
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error('Trip dates are invalid.')
  }
  if (hourText === undefined || minuteText === undefined) {
    return { date: `${yearText}-${monthText}-${dayText}`, time: '' }
  }
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (hour > 23 || minute > 59) throw new Error('Trip times are invalid.')
  return { date: `${yearText}-${monthText}-${dayText}`, time: `${hourText}:${minuteText}` }
}

function masterPreferences(family: FamilyPreferences): Record<string, unknown> {
  const start = normalizeTripDateTime(family.startDate ?? '')
  const end = normalizeTripDateTime(family.endDate ?? '')
  const master: Record<string, unknown> = {
    country: family.country ?? '',
    startDate: start.date,
    endDate: end.date,
    startTime: family.startTime || start.time,
    endTime: family.endTime || end.time,
    startCity: family.startCity ?? '',
    endCity: family.endCity ?? '',
    groupMembers: [],
    userTravelProfile: {},
  }
  const members = master.groupMembers as { name: string; userId?: string }[]
  const preferences = master.userTravelProfile as Record<string, { value: unknown; priority?: string }>

  for (const user of family.users) {
    if (user.userProfile?.name) {
      members.push({ name: user.userProfile.name, userId: user.userProfile.userId })
    }
  }

  const allPreferenceKeys = new Map<string, Record<string, unknown>>()
  for (const user of family.users) {
    for (const [key, rawAttributes] of Object.entries(user.userTravelProfile ?? {})) {
      const attributes = isRecord(rawAttributes) ? rawAttributes : {}
      const existing = allPreferenceKeys.get(key)
      if (!existing) {
        allPreferenceKeys.set(key, { ...attributes })
      } else if (
        typeof existing.priority !== 'string' &&
        typeof attributes.priority === 'string'
      ) {
        existing.priority = attributes.priority
      }
    }
  }
  for (const [key, attributes] of allPreferenceKeys) {
    const tuples = family.users.flatMap((user) => {
      const rawPreference = user.userTravelProfile?.[key]
      if (
        !isRecord(rawPreference) ||
        rawPreference.value === undefined ||
        rawPreference.value === null ||
        (Array.isArray(rawPreference.value) && rawPreference.value.length === 0) ||
        (typeof rawPreference.value === 'string' && !rawPreference.value.trim())
      ) {
        return []
      }
      const identity = `${user.userProfile?.name ?? 'Traveler'} (${user.userProfile?.userId ?? 'unknown'})`
      return [[identity, rawPreference.value] as const]
    })

    const priority = typeof attributes.priority === 'string' ? attributes.priority : undefined
    let value: unknown = null
    if (tuples.length > 0 && priority === 'critical') {
      const uniqueValues = new Map(tuples.map((tuple) => [JSON.stringify(tuple[1]), tuple[1]]))
      if (uniqueValues.size === 1) {
        value = tuples[0][1]
      } else {
        const distinctChoices = [...uniqueValues.values()].map(String).join(', ')
        const userPreferences = tuples.map(([identity, preference]) => `${identity}, ${String(preference)}`).join('; ')
        value = `WARNING: Not everybody's ${key} matches (${distinctChoices}). User preferences: ${userPreferences}`
      }
    } else if (tuples.length > 0 && (priority === 'flexible' || priority === 'weak_link')) {
      value = tuples
    }
    preferences[key] = { value, priority }
  }

  return master
}

export async function generateTripPlan(
  family: FamilyPreferences,
  apiKey: string,
): Promise<string> {
  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'Api-Revision': '2026-05-20',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      input: `${JSON.stringify(masterPreferences(family))}\n\n${generationPrompt}`,
      tools: [{ type: 'google_maps' }],
      generation_config: { thinking_level: 'low' },
      background: true,
      store: true,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: itinerarySchema,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    console.error(`Gemini interaction creation failed with HTTP ${response.status}.`)
    throw new Error('Gemini could not start itinerary generation.')
  }

  const result: unknown = await response.json()
  if (!isRecord(result) || typeof result.id !== 'string' || !result.id) {
    console.error('Gemini returned an interaction without an id.')
    throw new Error('Gemini did not return a generation id.')
  }
  return result.id
}

export async function getTripPlan(
  interactionId: string,
  apiKey: string,
): Promise<{ status: 'in_progress' } | { status: 'completed'; plan: unknown }> {
  const response = await fetch(
    `${GEMINI_INTERACTIONS_URL}/${encodeURIComponent(interactionId)}`,
    {
      headers: {
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    console.error(`Gemini interaction poll failed with HTTP ${response.status}.`)
    throw new Error('Gemini could not retrieve the itinerary.')
  }

  const result: unknown = await response.json()
  if (!isRecord(result)) throw new Error('Gemini returned an invalid interaction.')
  if (result.status === 'in_progress' || result.status === 'requires_action') {
    return { status: 'in_progress' }
  }
  if (result.status !== 'completed') {
    console.error(`Gemini interaction ended with status ${String(result.status)}.`)
    throw new Error('Gemini could not complete the itinerary.')
  }
  const outputText = outputTextFromInteraction(result)
  if (!outputText.trim()) {
    console.error(
      `Completed Gemini interaction had no text output (steps: ${Array.isArray(result.steps) ? result.steps.length : 0}).`,
    )
    throw new Error('Gemini completed the interaction without itinerary text.')
  }
  try {
    return { status: 'completed', plan: JSON.parse(outputText) as unknown }
  } catch (error) {
    console.error('Gemini returned invalid itinerary JSON.', error)
    throw new Error('Gemini returned an invalid itinerary.')
  }
}
