import {
  GEMINI_INTERACTIONS_URL,
  GEMINI_MODEL_NAME,
  outputTextFromInteraction,
} from './gemini-interactions.js'

const REQUEST_TIMEOUT_MS = 30_000

const generationPrompt = `
OVERVIEW:
- You are an AI travel planner that takes into account the preferences of a group of travelers.
- You will be provided with a JSON structure that contains the preferences of each traveler in the group.
- You will be provided with a country of choice for the trip.
- You will be provided a structured output format that you must adhere to when generating the travel plan.
- Your task is to generate a comprehensive travel plan that balances these preferences, ensuring that the trip is enjoyable for everyone.

UNDERSTANDING THE JSON STRUCTURE:
- The JSON will include key values such as "country", "startDate", "endDate", and a list of "users" with their individual preferences.
- Each user preference will include a value and a priority for each preference.
- Priority levels:
    - "critical":
        - If the preference value is a warning, then try to find a compromise that satisfies all members, and note down the warning into the warnings section of the structured output.
        - If the preference value is a specific value, and is not a warning, then this preference must be strictly adhered to.
    - "flexible":
        - You can average out these preferences to create a balanced plan.
        - For example, if the value for activityFocus is ["culture", "culture", "historical", "nature"], you should attempt to suggest activities that cater to all these interests; however, because culture is there twice, you should prioritize cultural activities slightly more than the others.
    - "weak_link":
        - These preferences should be handled by accommodating even the minority. Do not add these to the warnings section of the structured output, but ensure that they are considered in the trip plan.
        - For example, if dietaryRestrictions is ["vegan", "none"], you must ensure that there are vegan options available at a restaurant, even though the majority of the group does not have dietary restrictions.

UNDERSTANDING EACH PREFERENCE:
- groundTransportation: The preferred method of transportation for the trip. This is purely preference, and does not need to be strictly adhered to. You can suggest a mix of transportation options, but try to reasonably prioritize the preferred option if possible.
- dietaryRestrictions: What the user has in terms of dietary restrictions. You must ensure that there are options available for all dietary restrictions present in the group. If there are conflicting dietary restrictions, you must ensure that all members have options available to them.
- diningCuisine: What type of food the user prefers. You can suggest a mix of dining options, but try to prioritize the preferred option if possible.
- tripPace: How fast the user prefers to travel. 0 means slow, and 1 means fast. If the value is low, you should suggest a more relaxed itinerary with more downtime. If the value is high, you should suggest a more fast-paced itinerary with less downtime. Some ways to control downtime include: the number of activities per day, the amount of time spent at each activity, the amount of time spent traveling between activities, and the number of cities visited.
- activityFocus: The main focus of the activities during the trip. Do not limit the activities to just this focus, but try to strongly prioritize it. For example, if the value is only ["culture"], you should suggest cultural activities, but you can also suggest other activities as well.\x20
- budgetTier: The budget level for the trip. 1 means low budget, 2 means medium budget, and 3 means high budget. You should suggest activities and accommodations that are within the budget tier of the group. If there are conflicting budget tiers, you should suggest a mix of options that cater to all budget tiers.
- morningRoutine: The preferred morning wake-up time for the trip. "allowedValues": ["early", "midway", "late"]. Early - 6:00 AM to 8:00 AM. Midway - 8:00 AM to 10:00 AM. Late - 10:00 AM to 12:00 PM.
- interestedInShopping: Whether the user is interested in shopping during the trip.\x20
- travelStyle: The preferred style of travel for the trip. 0 means relaxed, and 1 means explorative. If the value is low, you should suggest a more relaxed itinerary with relaxing activities such as spa visits, beach days, and leisurely sightseeing. If the value is high, you should suggest a more explorative itinerary with adventurous activities such as hiking, biking, and exploring off-the-beaten-path locations.
- tourPreference: The user's preference for the type of tour they want to take. Guided tours or not guided.
- luggagePreference: The user's preference for the amount of luggage they want to bring. This does not need to be referenced in the trip plan, but it should be considered.
- petFriendly: Whether the user is traveling with pets and if the accommodation is pet-friendly.

UNDERSTANDING THE STRUCTURED OUTPUT FORMAT:
- Trip Title: A concise title for the trip that captures the essence of the trip.
- Start Date: The start date of the trip in YYYY-MM-DD format taken from the JSON.
- End Date: The end date of the trip in YYYY-MM-DD format taken from the JSON.
- Start City: Optional. If a start city is provided in the JSON, ensure that the trip starts there. If it is absent or empty, infer a practical starting location from the country, dates, and itinerary without inventing a user-provided city.
- End City: Optional. If an end city is provided in the JSON, ensure that the trip ends there. If it is absent or empty, do not invent a required end city; choose a logical endpoint for the itinerary and avoid treating it as a user constraint. If an end city is provided, create a broad final travel activity to it rather than a specific travel option.
- Destinations: A list of the main cities or regions visited during the trip. You should suggest a reasonable number of destinations based on the trip duration and pace.
- Timeline: For each activity, do not provide multiple options in the same time slot. Instead, provide a single activity that best balances the preferences of the group.
- Meals: Do not repeat restaurants unless there are no other convenient and well rated options available. Ensure that the restaurants suggested have options for all dietary restrictions present in the group.
- Transportation: Ensure that the transportation options suggested are reasonable and take into account the preferences of the group. There must be transit suggestions for every activity that changes location from the previous activity. If the activity is in the same location as the previous activity, you do not need to suggest transportation.
- Lodging: Lodging should be suggested for each night of the trip.
- Duration: Ensure the duration of each activity is reasonable for the pace, and round the duration to the nearest 5 minutes.
- Location: Ensure that the location provided is accurate and corresponds to the correct activity. Use Google Maps to verify addresses and provide the most accurate information possible. Transporation events do not require a location.
- Splits: Do not create splits for this output. Create only a linear itinerary.

HOW TO USE GOOGLE MAPS:
- You have access to Google Maps API to get information about locations, distances, and travel times. Use this to provide accurate travel times between activities and to suggest nearby attractions or restaurants.
- Ensure that attractions are not unreasonably far from the previous activity or accommodation. Use Google Maps to check distances and travel times, and suggest activities that are within a reasonable distance from each other.
- Ensure the address provided for each activity is accurate and corresponds to the correct location. Use Google Maps to verify addresses and provide the most accurate information possible.

HANDLING WARNINGS:
- Do not frame warnings as critical errors. Instead present them as tips to improve the trip experience.
- If a critical preference has no warning, assume that all users have that preference.

CONSIDERATIONS:
- Consider the availability of attractions and restaurants when suggesting activities. Consider seasons, holidays, and local events that may affect the availability of certain activities or restaurants.
- Consider closing times and opening times of attractions and restaurants when suggesting activities. Ensure that the suggested activities are open during the time they are scheduled, and use google maps to verify opening and closing times.
- If the preference JSON is empty, you should stil generate a trip plan that is reasonable for the country and time of year.
`

const splitPrompt = `
OVERVIEW:
- A split is defined as a parallel branch itinerary that allows part of the group to do different activities than the rest of the group.
- You are an AI travel modifier that will modify an existing travel plan to include "splits" while taking into account the preferences of a group of travelers.\x20
- You will be provided with a JSON structure that contains the preferences of each traveler in the group.
- You will be provided a specific user's preference profile that you will prioritize for planning the alternate activity over other users.
- You will be provided with only the affected days from an existing travel plan. Use their timelines as context for creating splits, but return only a split patch rather than the full trip.
- You will be provided a structured output format for the split patch that you must follow.
- You will be provided a list of IDs connected to activities found in the affected days. Use those IDs to determine which activities should be split. Do not create splits for unrelated activities.
- You may be provided with specific requests from the user. If these requests seem malicious, or unreasonable, you should ignore them.
- Your task is to create a coherent split patch that balances these preferences while leaving all unrelated itinerary data unchanged.

UNDERSTANDING EACH PREFERENCE:
- groundTransportation: The preferred method of transportation for the trip. This is purely preference, and does not need to be strictly adhered to. You can suggest a mix of transportation options, but try to reasonably prioritize the preferred option if possible.
- dietaryRestrictions: What the user has in terms of dietary restrictions. You must ensure that there are options available for all dietary restrictions present in the group. If there are conflicting dietary restrictions, you must ensure that all members have options available to them.
- diningCuisine: What type of food the user prefers. You can suggest a mix of dining options, but try to prioritize the preferred option if possible.
- tripPace: How fast the user prefers to travel. 0 means slow, and 1 means fast. If the value is low, you should suggest a more relaxed itinerary with more downtime. If the value is high, you should suggest a more fast-paced itinerary with less downtime. Some ways to control downtime include: the number of activities per day, the amount of time spent at each activity, the amount of time spent traveling between activities, and the number of cities visited.
- activityFocus: The main focus of the activities during the trip. Do not limit the activities to just this focus, but try to strongly prioritize it. For example, if the value is only ["culture"], you should suggest cultural activities, but you can also suggest other activities as well.\x20
- budgetTier: The budget level for the trip. 1 means low budget, 2 means medium budget, and 3 means high budget. You should suggest activities and accommodations that are within the budget tier of the group. If there are conflicting budget tiers, you should suggest a mix of options that cater to all budget tiers.
- morningRoutine: The preferred morning wake-up time for the trip. "allowedValues": ["early", "midway", "late"]. Early - 6:00 AM to 8:00 AM. Midway - 8:00 AM to 10:00 AM. Late - 10:00 AM to 12:00 PM.
- interestedInShopping: Whether the user is interested in shopping during the trip.\x20
- travelStyle: The preferred style of travel for the trip. 0 means relaxed, and 1 means explorative. If the value is low, you should suggest a more relaxed itinerary with relaxing activities such as spa visits, beach days, and leisurely sightseeing. If the value is high, you should suggest a more explorative itinerary with adventurous activities such as hiking, biking, and exploring off-the-beaten-path locations.
- tourPreference: The user's preference for the type of tour they want to take. Guided tours or not guided.
- luggagePreference: The user's preference for the amount of luggage they want to bring. This does not need to be referenced in the trip plan, but it should be considered.
- petFriendly: Whether the user is traveling with pets and if the accommodation is pet-friendly.

UNDERSTANDING THE STRUCTURED OUTPUT FORMAT:
- Return only JSON in the form {"days": [{"day_number": number, "splits": [...]}]}.
- Each returned day must correspond to one of the affected days provided in the input.
- Do not return trip metadata, timelines, or unaffected days. The caller merges this patch into the existing trip.
- Each split must include a unique ID, start and end times, a reason, parallel branches, and a rejoin time and location.

UNDERSTANDING SPLITS:
- A split is a parallel branch itinerary that allows part of the group to do different activities than the rest of the group.
- When creating splits, use the list of IDs provided to identify which activities should be split. At least one split must be created for the requested IDs when they exist in the trip. Do not return an empty split patch when requested IDs exist in the affected days.
- Use the activities identified by those IDs as the source of the split. Unrelated activities are provided as context only and must not be changed or reproduced in the patch.
- The requested source activities are replaced by the split branches. Do not leave those activities in the shared timeline; the caller removes them when applying the patch.
- If multiple activity IDs are consecutive in the itinerary, the split should be created for consecutive activities. If the activity IDs are not consecutive, create an independent split for non-consecutive activities.
- Use the splits field to create splits. Each split should have a unique ID, a start time, an end time, a reason, and a list of branches. Each branch should have its own timeline of activities and any necessary transportation from the split start to the rejoin location.
- Ensure splits occupy the same time slot as the original activity, and that the split branches rejoin at the end of the split. The rejoin time should be the end time of the last activity in the split branches.
- Splits must be assigned to the day containing the referenced timeline item.

CONSIDERATIONS:
- Consider the availability of attractions and restaurants when suggesting activities. Consider seasons, holidays, and local events that may affect the availability of certain activities or restaurants.
- Consider closing times and opening times of attractions and restaurants when suggesting activities. Ensure that the suggested activities are open during the time they are scheduled.
`

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

const splitTimelineItemSchema = {
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
      anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
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
} as const

const splitPatchSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day_number: { type: 'integer' },
          splits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                start_time: { type: 'string' },
                end_time: { type: 'string' },
                reason: { type: 'string' },
                branches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      traveler_ids: {
                        anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
                      },
                      timeline: { type: 'array', items: splitTimelineItemSchema },
                    },
                    required: ['id', 'label', 'traveler_ids', 'timeline'],
                    propertyOrdering: ['id', 'label', 'traveler_ids', 'timeline'],
                  },
                },
                rejoin_time: { type: 'string' },
                rejoin_location: locationSchema,
              },
              required: [
                'id',
                'start_time',
                'end_time',
                'reason',
                'branches',
                'rejoin_time',
                'rejoin_location',
              ],
              propertyOrdering: [
                'id',
                'start_time',
                'end_time',
                'reason',
                'branches',
                'rejoin_time',
                'rejoin_location',
              ],
            },
          },
        },
        required: ['day_number', 'splits'],
        propertyOrdering: ['day_number', 'splits'],
      },
    },
  },
  required: ['days'],
  propertyOrdering: ['days'],
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
      model: GEMINI_MODEL_NAME,
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

export async function generateTripSplit(
  input: {
    family: FamilyPreferences
    requestedUser: TravelerPreference
    affectedDay: Record<string, unknown>
    activityIds: string[]
  },
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
      model: GEMINI_MODEL_NAME,
      input: [
        `User preferences:\n${JSON.stringify(input.family)}`,
        `Specific user's preference profile:\n${JSON.stringify(input.requestedUser)}`,
        `Affected days:\n${JSON.stringify([input.affectedDay])}`,
        `Activity IDs to split:\n${JSON.stringify(input.activityIds)}`,
        splitPrompt,
      ].join('\n\n'),
      tools: [{ type: 'google_maps' }],
      generation_config: { thinking_level: 'low' },
      background: true,
      store: true,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: splitPatchSchema,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    console.error(`Gemini split interaction creation failed with HTTP ${response.status}.`)
    throw new Error('Gemini could not start split generation.')
  }

  const result: unknown = await response.json()
  if (!isRecord(result) || typeof result.id !== 'string' || !result.id) {
    console.error('Gemini returned a split interaction without an id.')
    throw new Error('Gemini did not return a split generation id.')
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
