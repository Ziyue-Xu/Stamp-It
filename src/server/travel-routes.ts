import type { Context, Hono } from 'hono'
import { enqueueJob } from 'deepspace/worker'
import type {
  ActionResult,
  GetActionData,
  MutateActionData,
} from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import {
  createNegotiationRequest,
  getNegotiationStatus,
  respondToNegotiationRequest,
  startNegotiationSession,
  withNegotiationFamilyLock,
} from './negotiation-store.js'
import type { NegotiationSource } from './negotiation-store.js'
import { NegotiationError } from './negotiation.js'
import { generateTripPlan, generateTripSplit, getTripPlan } from './trip-planner.js'

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
  mode: 'login' | 'signup'
  expiresAt: number
}

interface TripPlanToken {
  interactionId: string
  familyCode: string
  userId: string
  expiresAt: number
}

interface TripSplitToken {
  interactionId: string
  familyCode: string
  userId: string
  dayNumber: number
  itemId: string
  sourceDigest: string
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
  }
  userTravelProfile: Record<string, unknown>
}

interface TravelFamily {
  familyCode: string
  country: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  startCity: string
  endCity: string
  users: FamilyMember[]
  negotiationState?: unknown
}

const TRAVEL_PREFERENCE_DEFAULTS = {
  groundTransportation: { value: null, priority: 'critical' },
  dietaryRestrictions: { value: [], priority: 'weak_link' },
  diningCuisine: { value: null, priority: 'flexible' },
  tripPace: { value: null, priority: 'flexible' },
  activityFocus: { value: [], priority: 'flexible' },
  budgetTier: { value: null, priority: 'critical' },
  morningRoutine: { value: null, priority: 'critical' },
  interestedInShopping: { value: null, priority: 'flexible' },
  travelStyle: { value: null, priority: 'flexible' },
  tourPreference: { value: null, priority: 'flexible' },
  luggagePreference: { value: null, priority: 'critical' },
  petFriendly: { value: null, priority: 'weak_link' },
  activityPopularity: { value: null, priority: 'flexible' },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isGeneratedTripPlan(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.trip_title !== 'string' ||
    typeof value.start_date !== 'string' ||
    typeof value.end_date !== 'string' ||
    !Array.isArray(value.destinations) ||
    !value.destinations.every((destination) => typeof destination === 'string') ||
    !Array.isArray(value.days) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === 'string')
  ) {
    return false
  }

  return value.days.every(
    (day) =>
      isRecord(day) &&
      typeof day.day_number === 'number' &&
      typeof day.date === 'string' &&
      typeof day.base_city === 'string' &&
      typeof day.day_theme_or_summary === 'string' &&
      Array.isArray(day.timeline) &&
      day.timeline.every(
        (item) =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          ['lodging', 'activity', 'meal', 'transit'].includes(String(item.item_type)) &&
          typeof item.title === 'string' &&
          typeof item.start_time === 'string' &&
          typeof item.end_time === 'string' &&
          (typeof item.duration_minutes === 'number' || item.duration_minutes === null) &&
          (item.location === null || isRecord(item.location)) &&
          (item.transit_details === null || isRecord(item.transit_details)) &&
          (item.notes_and_tips === null ||
            (Array.isArray(item.notes_and_tips) &&
              item.notes_and_tips.every((tip) => typeof tip === 'string'))) &&
          (item.estimated_cost === null ||
            (isRecord(item.estimated_cost) &&
              typeof item.estimated_cost.amount === 'number' &&
              typeof item.estimated_cost.currency === 'string' &&
              typeof item.estimated_cost.is_per_person === 'boolean')),
      ),
  )
}

function isEditableTravelPlan(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    Array.isArray(value.days) &&
    value.days.every(
      (day) =>
        isRecord(day) &&
        typeof day.dayNumber === 'number' &&
        typeof day.date === 'string' &&
        typeof day.city === 'string' &&
        typeof day.theme === 'string' &&
        Array.isArray(day.items) &&
        day.items.every((item) => isRecord(item) && typeof item.id === 'string'),
    )
  )
}

function isGeneratedSplitPatch(value: unknown, dayNumber: number): value is Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.days) || value.days.length !== 1) return false
  const day = value.days[0]
  if (
    !isRecord(day) ||
    day.day_number !== dayNumber ||
    !Array.isArray(day.splits) ||
    day.splits.length !== 1
  ) {
    return false
  }
  const split = day.splits[0]
  if (
    !isRecord(split) ||
    typeof split.id !== 'string' ||
    typeof split.start_time !== 'string' ||
    typeof split.end_time !== 'string' ||
    typeof split.reason !== 'string' ||
    typeof split.rejoin_time !== 'string' ||
    !isRecord(split.rejoin_location) ||
    typeof split.rejoin_location.name !== 'string' ||
    !(typeof split.rejoin_location.address === 'string' || split.rejoin_location.address === null) ||
    !Array.isArray(split.branches) ||
    split.branches.length === 0
  ) {
    return false
  }
  return split.branches.every(
    (branch) =>
      isRecord(branch) &&
      typeof branch.id === 'string' &&
      typeof branch.label === 'string' &&
      (branch.traveler_ids === null ||
        (Array.isArray(branch.traveler_ids) &&
          branch.traveler_ids.every((userId) => typeof userId === 'string'))) &&
      Array.isArray(branch.timeline) &&
      branch.timeline.length > 0 &&
      branch.timeline.every(isGeneratedTimelineItem),
  )
}

function isGeneratedTimelineItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    ['lodging', 'activity', 'meal', 'transit'].includes(String(value.item_type)) &&
    typeof value.title === 'string' &&
    typeof value.start_time === 'string' &&
    typeof value.end_time === 'string' &&
    (typeof value.duration_minutes === 'number' || value.duration_minutes === null) &&
    (value.location === null ||
      (isRecord(value.location) &&
        typeof value.location.name === 'string' &&
        (typeof value.location.address === 'string' || value.location.address === null))) &&
    (value.transit_details === null || isRecord(value.transit_details)) &&
    (value.notes_and_tips === null ||
      (Array.isArray(value.notes_and_tips) &&
        value.notes_and_tips.every((tip) => typeof tip === 'string'))) &&
    (value.estimated_cost === null ||
      (isRecord(value.estimated_cost) &&
        typeof value.estimated_cost.amount === 'number' &&
        typeof value.estimated_cost.currency === 'string' &&
        typeof value.estimated_cost.is_per_person === 'boolean'))
  )
}

function frontendItemFromGenerated(value: Record<string, unknown>): Record<string, unknown> {
  const location = isRecord(value.location) ? value.location : null
  const transit = isRecord(value.transit_details) ? value.transit_details : null
  const rawCost = isRecord(value.estimated_cost) ? value.estimated_cost : null
  const cost =
    rawCost && typeof rawCost.amount === 'number' && typeof rawCost.currency === 'string'
      ? { amount: rawCost.amount, currency: rawCost.currency }
      : null
  return {
    id: String(value.id),
    type: typeof value.item_type === 'string' ? value.item_type : 'activity',
    title: typeof value.title === 'string' ? value.title : '',
    start: typeof value.start_time === 'string' ? value.start_time : '',
    end: typeof value.end_time === 'string' ? value.end_time : '',
    minutes: typeof value.duration_minutes === 'number' ? value.duration_minutes : null,
    place: typeof location?.name === 'string' ? location.name : '',
    address: typeof location?.address === 'string' ? location.address : '',
    transit: transit
      ? {
          mode: typeof transit.mode === 'string' ? transit.mode : '',
          line: typeof transit.provider_or_line === 'string' ? transit.provider_or_line : '',
          km: typeof transit.distance_km === 'number' ? transit.distance_km : null,
        }
      : null,
    tips: Array.isArray(value.notes_and_tips) ? value.notes_and_tips : [],
    cost,
    addedBy: null,
  }
}

function frontendPlanFromGenerated(
  value: Record<string, unknown>,
  family: TravelFamily,
): Record<string, unknown> {
  const tripTitle = typeof value.trip_title === 'string' ? value.trip_title : 'Your itinerary'
  const titleSeparator = tripTitle.indexOf(':')
  const days = (value.days as Record<string, unknown>[]).map((rawDay) => {
    const timeline = rawDay.timeline as Record<string, unknown>[]
    const items = timeline.map(frontendItemFromGenerated)
    const total = frontendItemsTotal(items)
    return {
      dayNumber: rawDay.day_number,
      date: rawDay.date,
      city: rawDay.base_city,
      theme: rawDay.day_theme_or_summary,
      total,
      items,
    }
  })
  const total = frontendItemsTotal(days.flatMap((day) => day.items as Record<string, unknown>[]))
  const cities: { name: string; days: number }[] = []
  for (const day of days) {
    const name = String(day.city ?? '')
    const previous = cities[cities.length - 1]
    if (previous?.name === name) previous.days += 1
    else cities.push({ name, days: 1 })
  }
  return {
    title: titleSeparator < 0 ? tripTitle : tripTitle.slice(0, titleSeparator).trim(),
    subtitle: titleSeparator < 0 ? '' : tripTitle.slice(titleSeparator + 1).trim(),
    startDate: value.start_date,
    endDate: value.end_date,
    cities,
    total,
    notes: [],
    days,
  }
}

function editablePlanFromStored(
  stored: { format?: string; plan: unknown },
  family: TravelFamily,
): Record<string, unknown> | null {
  if (stored.format === 'travel-app') {
    return isEditableTravelPlan(stored.plan) ? stored.plan : null
  }
  return isGeneratedTripPlan(stored.plan)
    ? frontendPlanFromGenerated(stored.plan, family)
    : null
}

function frontendItemsTotal(items: Record<string, unknown>[]): { amount: number; currency: string } | null {
  let amount = 0
  let currency = ''
  for (const item of items) {
    if (!isRecord(item.cost) || typeof item.cost.amount !== 'number') continue
    amount += item.cost.amount
    if (!currency && typeof item.cost.currency === 'string') currency = item.cost.currency
  }
  return currency ? { amount, currency } : null
}

function preserveSharedSplits(
  savedPlan: Record<string, unknown>,
  submittedPlan: Record<string, unknown>,
  userId: string,
  removedGroupIds: Set<string>,
): Record<string, unknown> {
  if (!Array.isArray(savedPlan.days) || !Array.isArray(submittedPlan.days)) {
    return submittedPlan
  }
  const days = (submittedPlan.days as Record<string, unknown>[]).map((day) => {
    if (!Array.isArray(day.items)) return day
    const savedDay = (savedPlan.days as Record<string, unknown>[]).find(
      (candidate) => candidate.dayNumber === day.dayNumber && Array.isArray(candidate.items),
    )
    if (!savedDay) return day
    const items = (day.items as Record<string, unknown>[]).slice()
    for (const savedSplit of savedDay.items as Record<string, unknown>[]) {
      if (savedSplit.type !== 'split' || typeof savedSplit.id !== 'string') continue
      const index = items.findIndex((item) => item.id === savedSplit.id)
      const submittedSplit = index >= 0 ? items[index] : undefined
      const savedGroups = Array.isArray(savedSplit.groups)
        ? savedSplit.groups.filter(isRecord)
        : []
      const submittedGroups =
        submittedSplit && Array.isArray(submittedSplit.groups)
          ? submittedSplit.groups.filter(isRecord)
          : []
      const groupsById = new Map<string, Record<string, unknown>>()
      for (const group of savedGroups) {
        if (typeof group.id !== 'string') continue
        const canRemove =
          group.ownerId === userId &&
          removedGroupIds.has(group.id) &&
          !(isRecord(savedSplit.picks) &&
            Object.entries(savedSplit.picks).some(
              ([memberId, groupId]) => memberId !== userId && groupId === group.id,
            ))
        if (!canRemove) groupsById.set(group.id, group)
      }
      for (const group of submittedGroups) {
        if (typeof group.id === 'string' && !groupsById.has(group.id)) {
          groupsById.set(group.id, group)
        }
      }
      const groups = [...groupsById.values()]
      const savedPicks = isRecord(savedSplit.picks) ? savedSplit.picks : {}
      const submittedPicks =
        submittedSplit && isRecord(submittedSplit.picks) ? submittedSplit.picks : {}
      const picks: Record<string, unknown> = { ...savedPicks }
      if (Object.hasOwn(submittedPicks, userId)) picks[userId] = submittedPicks[userId]
      else if (
        removedGroupIds.size > 0 &&
        savedGroups.some(
          (group) =>
            group.ownerId === userId &&
            removedGroupIds.has(String(group.id)) &&
            savedPicks[userId] === group.id,
        )
      ) {
        delete picks[userId]
      }
      const validGroupIds = new Set(groups.map((group) => group.id))
      for (const [memberId, groupId] of Object.entries(picks)) {
        if (!validGroupIds.has(groupId)) delete picks[memberId]
      }
      if (groups.length === 1 && Array.isArray(groups[0].items)) {
        if (index >= 0) items.splice(index, 1, ...(groups[0].items as Record<string, unknown>[]))
        else items.push(...(groups[0].items as Record<string, unknown>[]))
        continue
      }
      const mergedSplit = { ...savedSplit, groups, picks }
      if (index >= 0) {
        items[index] = mergedSplit
      } else {
        const originalGroup = savedGroups.find((group) => group.kind === 'original')
        const originalStop =
          originalGroup && Array.isArray(originalGroup.items)
            ? (originalGroup.items as Record<string, unknown>[]).find(
                (item) => typeof item.id === 'string',
              )
            : undefined
        const originalIndex = originalStop
          ? items.findIndex((item) => item.id === originalStop.id)
          : -1
        if (originalIndex >= 0) items.splice(originalIndex, 1, mergedSplit)
        else items.push(mergedSplit)
      }
    }
    return {
      ...day,
      items,
      total: frontendItemsTotal(items),
    }
  })
  const allItems = days.flatMap((day) =>
    Array.isArray(day.items) ? (day.items as Record<string, unknown>[]) : [],
  )
  const cities: { name: string; days: number }[] = []
  for (const day of days) {
    const name = String(day.city ?? '')
    const previous = cities[cities.length - 1]
    if (previous?.name === name) previous.days += 1
    else cities.push({ name, days: 1 })
  }
  return {
    ...submittedPlan,
    days,
    cities,
    total: frontendItemsTotal(allItems),
  }
}

function frontendItemToGenerated(item: Record<string, unknown>): Record<string, unknown> {
  const location =
    typeof item.place === 'string' && item.place
      ? { name: item.place, address: typeof item.address === 'string' && item.address ? item.address : null }
      : null
  const transit = isRecord(item.transit) ? item.transit : null
  const cost = isRecord(item.cost) ? item.cost : null
  return {
    id: item.id,
    item_type: item.type,
    title: item.title,
    start_time: item.start,
    end_time: item.end,
    duration_minutes: item.minutes ?? null,
    location,
    transit_details: transit
      ? {
          mode: transit.mode ?? 'walking',
          provider_or_line: transit.line ?? null,
          route_number: null,
          distance_km: transit.km ?? null,
        }
      : null,
    estimated_cost:
      cost && typeof cost.amount === 'number'
        ? {
            amount: cost.amount,
            currency: typeof cost.currency === 'string' ? cost.currency : 'EUR',
            is_per_person: true,
          }
        : null,
    notes_and_tips: Array.isArray(item.tips) ? item.tips : [],
  }
}

function frontendDayForSplitPrompt(
  day: Record<string, unknown>,
  dayNumber: number,
): Record<string, unknown> {
  if (Array.isArray(day.timeline)) return day
  const items = Array.isArray(day.items) ? day.items.filter(isRecord) : []
  const timeline = items
    .filter((item) => item.type !== 'split')
    .map(frontendItemToGenerated)
  const splits = items
    .filter((item) => item.type === 'split')
    .map((item) => ({
      id: item.id,
      start_time: item.start,
      end_time: item.end,
      reason: typeof item.reason === 'string' ? item.reason : '',
      branches: Array.isArray(item.groups)
        ? item.groups.filter(isRecord).map((group) => ({
            id: group.id,
            label: group.label,
            traveler_ids: Array.isArray(group.members)
              ? group.members.filter(isRecord).map((member) => member.userId)
              : [],
            timeline: Array.isArray(group.items)
              ? group.items.filter(isRecord).map(frontendItemToGenerated)
              : [],
          }))
        : [],
      rejoin_time: isRecord(item.regroup) ? item.regroup.time : item.end,
      rejoin_location: isRecord(item.regroup)
        ? { name: item.regroup.place, address: item.regroup.address || null }
        : { name: '', address: null },
    }))
  return {
    day_number: dayNumber,
    date: day.date,
    base_city: day.city,
    day_theme_or_summary: day.theme,
    timeline,
    splits,
  }
}

function sourceItemInDay(
  day: Record<string, unknown>,
  itemId: string,
): { source: Record<string, unknown>; split: Record<string, unknown> | null } | null {
  if (!Array.isArray(day.items)) return null
  const items = day.items.filter(isRecord)
  const direct = items.find((item) => item.id === itemId)
  if (direct && (direct.type === 'activity' || direct.type === 'meal')) {
    return { source: direct, split: null }
  }
  for (const item of items) {
    if (item.type !== 'split' || !Array.isArray(item.groups)) continue
    for (const rawGroup of item.groups) {
      if (!isRecord(rawGroup) || !Array.isArray(rawGroup.items)) continue
      const source = rawGroup.items.filter(isRecord).find((candidate) => candidate.id === itemId)
      if (source && (source.type === 'activity' || source.type === 'meal')) {
        return { source, split: item }
      }
    }
  }
  return null
}

function splitAlreadyOwnedBy(
  day: Record<string, unknown>,
  itemId: string,
  userId: string,
): boolean {
  if (!Array.isArray(day.items)) return false
  return day.items.filter(isRecord).some(
    (item) =>
      item.type === 'split' &&
      Array.isArray(item.groups) &&
      item.groups.filter(isRecord).some(
        (group) =>
          group.ownerId === userId &&
          Array.isArray(group.items) &&
          group.items.filter(isRecord).some((source) => source.id === itemId),
      ),
  )
}

function mergeGeneratedSplit(
  plan: Record<string, unknown>,
  dayIndex: number,
  itemId: string,
  user: FamilyMember,
  patchSplit: Record<string, unknown>,
): Record<string, unknown> {
  const days = plan.days as Record<string, unknown>[]
  const day = days[dayIndex]
  const sourceResult = sourceItemInDay(day, itemId)
  if (!sourceResult || !Array.isArray(day.items)) throw new Error('The activity is no longer in this itinerary.')
  const { source, split: existingSplit } = sourceResult
  const rawBranches = patchSplit.branches as Record<string, unknown>[]
  const requestedBranch =
    rawBranches.find(
      (branch) =>
        Array.isArray(branch.traveler_ids) && branch.traveler_ids.includes(user.userProfile.userId),
    ) ?? rawBranches[0]
  const sourceSplitId =
    existingSplit && typeof existingSplit.id === 'string' ? existingSplit.id : `split-${itemId}`
  const branchId = `alt-${encodeURIComponent(user.userProfile.userId)}`
  const newBranchItems = (requestedBranch.timeline as Record<string, unknown>[]).map((item, index) => ({
    ...frontendItemFromGenerated(item),
    id: `${branchId}-${index + 1}`,
  }))
  const regroupLocation = isRecord(patchSplit.rejoin_location) ? patchSplit.rejoin_location : {}
  const newGroup = {
    id: branchId,
    kind: 'alt',
    label: requestedBranch.label || 'Alternative',
    ownerId: user.userProfile.userId,
    ownerName: user.userProfile.name,
    members: [{ userId: user.userProfile.userId, name: user.userProfile.name }],
    items: newBranchItems,
  }
  const split: Record<string, unknown> = existingSplit
    ? {
        ...existingSplit,
        reason: typeof patchSplit.reason === 'string' ? patchSplit.reason : existingSplit.reason,
        picks: {
          ...(isRecord(existingSplit.picks) ? existingSplit.picks : {}),
          [user.userProfile.userId]: branchId,
        },
        groups: [...(Array.isArray(existingSplit.groups) ? existingSplit.groups : []), newGroup],
      }
    : {
        id: sourceSplitId,
        type: 'split',
        origin: 'stop',
        title: source.title,
        reason: patchSplit.reason,
        start: source.start,
        end: source.end,
        minutes: source.minutes ?? null,
        place: '',
        address: '',
        transit: null,
        tips: [],
        cost: source.cost ?? null,
        addedBy: null,
        regroup: {
          place: typeof regroupLocation.name === 'string' ? regroupLocation.name : '',
          address: typeof regroupLocation.address === 'string' ? regroupLocation.address : '',
          time: typeof patchSplit.rejoin_time === 'string' ? patchSplit.rejoin_time : source.end,
        },
        defaultGroup: `original-${itemId}`,
        picks: { [user.userProfile.userId]: branchId },
        groups: [
          {
            id: `original-${itemId}`,
            kind: 'original',
            label: '',
            ownerId: null,
            ownerName: '',
            members: [],
            items: [source],
          },
          newGroup,
        ],
      }
  const updatedItems = existingSplit
    ? (day.items as Record<string, unknown>[]).map((item) => (item.id === existingSplit.id ? split : item))
    : (day.items as Record<string, unknown>[]).map((item) => (item.id === itemId ? split : item))
  const updatedDay: Record<string, unknown> = { ...day, items: updatedItems }
  const updatedDays: Record<string, unknown>[] = days.map((entry, index) =>
    index === dayIndex ? updatedDay : entry,
  )
  const updatedPlan = { ...plan, days: updatedDays }
  const allItems = updatedDays.flatMap((entry) =>
    Array.isArray(entry.items) ? (entry.items as Record<string, unknown>[]) : [],
  )
  const cities: { name: string; days: number }[] = []
  for (const entry of updatedDays) {
    const name = String(entry.city ?? '')
    const previous = cities[cities.length - 1]
    if (previous?.name === name) previous.days += 1
    else cities.push({ name, days: 1 })
  }
  return {
    ...updatedPlan,
    days: updatedDays.map((entry) => ({
      ...entry,
      total: frontendItemsTotal(Array.isArray(entry.items) ? entry.items as Record<string, unknown>[] : []),
    })),
    cities,
    total: frontendItemsTotal(allItems),
  }
}

async function valueDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return encodeBase64Url(digest)
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

function auth0Config(env: Env): { domain: string; clientId: string } | null {
  const domain = env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//u, '').replace(/\/$/u, '')
  const clientId = env.AUTH0_CLIENT_ID?.trim()
  if (!domain || !clientId || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(domain)) return null
  return { domain, clientId }
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
  const planMatch = /^plans\/(\d{4})\.json$/u.exec(key)
  if (planMatch) return { collection: 'travel-plans', recordId: planMatch[1] }
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
  let result: ActionResult<T>
  try {
    result = (await response.json()) as ActionResult<T>
  } catch {
    throw new Error(`DeepSpace record operation returned an invalid response (${response.status}).`)
  }
  if (!result.success) throw new Error(`DeepSpace record operation failed: ${result.error}`)
  if (!response.ok) throw new Error(`DeepSpace record operation failed (${response.status}).`)
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
  const result = (await response.json()) as ActionResult<GetActionData>
  if (!result.success) {
    if (/not found|does not exist/iu.test(result.error)) return null
    throw new Error(`DeepSpace record read failed: ${result.error}`)
  }
  if (!response.ok) throw new Error(`DeepSpace record read failed (${response.status}).`)
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

async function deleteStored(env: Env, key: string): Promise<void> {
  const { collection, recordId } = keyParts(key)
  if (!(await getStored(env, key))) return
  await executeRecordTool<MutateActionData>(env, 'records.delete', {
    collection,
    recordId,
  })
}

function userKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}.json`
}

function familyKey(familyCode: string): string {
  return `families/${familyCode}.json`
}

function planKey(familyCode: string): string {
  return `plans/${familyCode}.json`
}

function validFamilyCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/u.test(value)
}

function familyDetailsFromBody(
  body: Record<string, unknown>,
): Omit<TravelFamily, 'familyCode' | 'users'> | null {
  if (
    typeof body.country !== 'string' ||
    !body.country.trim() ||
    body.country.trim().length > 120 ||
    (body.startCity !== undefined &&
      (typeof body.startCity !== 'string' || body.startCity.length > 120)) ||
    (body.endCity !== undefined &&
      (typeof body.endCity !== 'string' || body.endCity.length > 120)) ||
    (body.arrivalCity !== undefined &&
      (typeof body.arrivalCity !== 'string' || body.arrivalCity.length > 120)) ||
    (body.departureCity !== undefined &&
      (typeof body.departureCity !== 'string' || body.departureCity.length > 120))
  ) {
    return null
  }
  try {
    const start = normalizeDateTime(body.startDate, body.startTime)
    const end = normalizeDateTime(body.endDate, body.endTime)
    if (end.date <= start.date) return null
    return {
      country: body.country.trim(),
      startDate: start.date,
      endDate: end.date,
      startTime: start.time,
      endTime: end.time,
      startCity:
        typeof body.startCity === 'string'
          ? body.startCity.trim()
          : typeof body.arrivalCity === 'string'
            ? body.arrivalCity.trim()
            : '',
      endCity:
        typeof body.endCity === 'string'
          ? body.endCity.trim()
          : typeof body.departureCity === 'string'
            ? body.departureCity.trim()
            : '',
    }
  } catch {
    return null
  }
}

function normalizeDateTime(value: unknown, explicitTime: unknown): { date: string; time: string } {
  if (typeof value !== 'string') throw new Error('Stored trip dates are invalid.')
  const text = value.trim()
  const usDate =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?$/iu.exec(text)
  const isoDate =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.exec(
      text,
    )
  let year: number
  let month: number
  let day: number
  let time = ''
  if (usDate) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = usDate
    year = Number(yearText)
    month = Number(monthText)
    day = Number(dayText)
    if (hourText && minuteText && meridiem) {
      const hour = Number(hourText)
      const minute = Number(minuteText)
      if (hour < 1 || hour > 12 || minute > 59) throw new Error('Stored trip times are invalid.')
      time = `${String((hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${minuteText}`
    }
  } else if (isoDate) {
    const [, yearText, monthText, dayText, hourText, minuteText] = isoDate
    year = Number(yearText)
    month = Number(monthText)
    day = Number(dayText)
    if (hourText && minuteText) time = `${hourText}:${minuteText}`
  } else {
    throw new Error('Stored trip dates are invalid.')
  }
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error('Stored trip dates are invalid.')
  }
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (typeof explicitTime === 'string' && explicitTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(explicitTime)) {
      throw new Error('Stored trip times are invalid.')
    }
    time = explicitTime
  }
  return { date, time }
}

function emptyTravelProfile(): Record<string, { value: unknown; priority: string }> {
  return Object.fromEntries(
    Object.entries(TRAVEL_PREFERENCE_DEFAULTS).map(([key, preference]) => [
      key,
      { value: Array.isArray(preference.value) ? [] : preference.value, priority: preference.priority },
    ]),
  )
}

function normalizeTravelProfile(value: unknown): Record<string, { value: unknown; priority: string }> {
  const profile = emptyTravelProfile()
  if (!isRecord(value)) return profile
  for (const [oldKey, rawPreference] of Object.entries(value)) {
    const key = oldKey === 'attractionPopularity' ? 'activityPopularity' : oldKey
    if (!(key in TRAVEL_PREFERENCE_DEFAULTS) || !isRecord(rawPreference)) continue
    const defaultPreference = profile[key]
    if (rawPreference.value !== undefined) defaultPreference.value = rawPreference.value
  }
  return profile
}

function mergeTravelProfile(
  existing: unknown,
  updates: unknown,
): Record<string, { value: unknown; priority: string }> {
  const profile = normalizeTravelProfile(existing)
  if (!isRecord(updates)) return profile

  for (const [oldKey, rawPreference] of Object.entries(updates)) {
    const key = oldKey === 'attractionPopularity' ? 'activityPopularity' : oldKey
    if (
      !(key in TRAVEL_PREFERENCE_DEFAULTS) ||
      !isRecord(rawPreference) ||
      !Object.hasOwn(rawPreference, 'value')
    ) {
      continue
    }
    profile[key] = { ...profile[key], value: rawPreference.value }
  }
  return profile
}

function normalizeFamily(value: unknown, familyCode: string): TravelFamily {
  if (!isRecord(value)) throw new Error(`Stored family ${familyCode} is invalid.`)
  const start = normalizeDateTime(value.startDate, value.startTime)
  const end = normalizeDateTime(value.endDate, value.endTime)
  const rawUsers = Array.isArray(value.users) ? value.users : []
  const users: FamilyMember[] = rawUsers.map((rawMember) => {
    if (!isRecord(rawMember) || !isRecord(rawMember.userProfile)) {
      throw new Error(`Stored family ${familyCode} contains an invalid user profile.`)
    }
    const profile = rawMember.userProfile
    return {
      userProfile: {
        userId: typeof profile.userId === 'string' ? profile.userId : '',
        name: typeof profile.name === 'string' ? profile.name : '',
        email: typeof profile.email === 'string' ? profile.email : '',
      },
      userTravelProfile: normalizeTravelProfile(rawMember.userTravelProfile),
    }
  })
  const ownerId = typeof value.ownerId === 'string' ? value.ownerId : undefined
  if (ownerId) {
    const ownerIndex = users.findIndex((member) => member.userProfile.userId === ownerId)
    if (ownerIndex > 0) users.unshift(...users.splice(ownerIndex, 1))
  }
  return {
    familyCode,
    country: typeof value.country === 'string' ? value.country : '',
    startDate: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    startCity:
      typeof value.startCity === 'string'
        ? value.startCity
        : typeof value.arrivalCity === 'string'
          ? value.arrivalCity
          : '',
    endCity:
      typeof value.endCity === 'string'
        ? value.endCity
        : typeof value.departureCity === 'string'
          ? value.departureCity
          : '',
    users,
    ...(value.negotiationState === undefined
      ? {}
      : { negotiationState: value.negotiationState }),
  }
}

async function getFamily(env: Env, familyCode: string): Promise<TravelFamily | null> {
  const key = familyKey(familyCode)
  const stored = await getStored<unknown>(env, key)
  if (!stored) return null
  const family = normalizeFamily(stored, familyCode)
  if (JSON.stringify(stored) !== JSON.stringify(family)) {
    await executeRecordTool<MutateActionData>(env, 'records.update', {
      collection: 'travel-families',
      recordId: familyCode,
      data: family,
    })
  }
  return family
}

function memberFor(user: TravelUser): FamilyMember {
  return {
    userProfile: {
      userId: user.userId,
      name: user.name,
      email: user.email,
    },
    userTravelProfile: emptyTravelProfile(),
  }
}

async function persistFamily(env: Env, family: TravelFamily): Promise<void> {
  await putStored(env, familyKey(family.familyCode), family)
}

function frontendDateTime(date: string, time: string): string {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date) ?? []
  if (!year || !month || !day) return date
  if (!time) return `${Number(month)}/${Number(day)}/${year}`
  const [, hourText, minute] = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(time) ?? []
  if (!hourText || !minute) return date
  const hour = Number(hourText)
  return `${Number(month)}/${Number(day)}/${year}, ${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

function frontendTravelProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const { activityPopularity, ...preferences } = profile
  return { ...preferences, attractionPopularity: activityPopularity }
}

function familyResponse(family: TravelFamily, includeMembers = true) {
  return {
    family_code: family.familyCode,
    country: family.country,
    startDate: frontendDateTime(family.startDate, family.startTime),
    endDate: frontendDateTime(family.endDate, family.endTime),
    arrivalCity: family.startCity,
    departureCity: family.endCity,
    users: includeMembers
      ? family.users.map((member) => ({
          userProfile: member.userProfile,
          userTravelProfile: frontendTravelProfile(member.userTravelProfile),
        }))
      : [],
  }
}

async function requireFamilyMember(
  c: Context<AppContext>,
  familyCode: string,
  userId: string,
): Promise<{ family: TravelFamily } | { response: Response }> {
  const family = await getFamily(c.env, familyCode)
  if (!family) return { response: jsonError(c, 'That family code was not found.', 404) }
  if (!family.users.some((member) => member.userProfile.userId === userId)) {
    return { response: jsonError(c, 'You are not a member of this family.', 403) }
  }
  return { family }
}

function registerNegotiationRoutes(
  app: Hono<AppContext>,
  prefix: string,
  source: NegotiationSource,
): void {
  const base = `${prefix}/:familyCode/negotiations`

  app.get(`${base}/analyze`, async (c) => {
    const auth = await currentSession(c)
    if ('response' in auth) return auth.response
    const familyCode = c.req.param('familyCode') ?? ''
    try {
      const result = await getNegotiationStatus(
        c.env,
        source,
        familyCode,
        auth.session.userId,
      )
      return c.json({ familyCode: result.familyCode, conflicts: result.conflicts })
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })

  app.get(`${base}/status`, async (c) => {
    const auth = await currentSession(c)
    if ('response' in auth) return auth.response
    const familyCode = c.req.param('familyCode') ?? ''
    try {
      const result = await getNegotiationStatus(
        c.env,
        source,
        familyCode,
        auth.session.userId,
      )
      return c.json({
        familyCode: result.familyCode,
        conflicts: result.conflicts,
        requests: result.requests,
        negotiatedValues: result.negotiatedValues,
        resolvedPreferences: result.resolvedPreferences,
        balanced: result.balanced,
        questionLimitReached: result.questionLimitReached,
        sessionStatus: result.sessionStatus,
        sessionId: result.sessionId,
        sessionQuestionCount: result.sessionQuestionCount,
        sessionQuestionLimit: result.sessionQuestionLimit,
      })
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })

  app.post(`${base}/start`, async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const auth = await currentSession(c)
    if ('response' in auth) return auth.response
    const familyCode = c.req.param('familyCode') ?? ''
    try {
      const result = await startNegotiationSession(
        c.env,
        source,
        familyCode,
        auth.session.userId,
      )
      return c.json({
        familyCode: result.familyCode,
        sessionStatus: result.sessionStatus,
        sessionId: result.sessionId,
        sessionQuestionCount: result.sessionQuestionCount,
        sessionQuestionLimit: result.sessionQuestionLimit,
        conflicts: result.conflicts,
        requests: result.requests,
        resolvedPreferences: result.resolvedPreferences,
        balanced: result.balanced,
        questionLimitReached: result.questionLimitReached,
      })
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })

  app.post(`${base}/requests`, async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const auth = await currentSession(c)
    if ('response' in auth) return auth.response
    const body = await readJsonBody(c)
    if (!body || typeof body.preference !== 'string' || !body.preference.trim()) {
      return jsonError(c, 'A preference key is required.', 400)
    }
    if (
      body.targetUserId !== undefined &&
      (typeof body.targetUserId !== 'string' || !body.targetUserId)
    ) {
      return jsonError(c, 'Target user ID must identify a family member.', 400)
    }
    const idempotencyKey = c.req.header('Idempotency-Key') ?? body.idempotencyKey
    if (
      typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 128
    ) {
      return jsonError(c, 'A unique Idempotency-Key of at most 128 characters is required.', 400)
    }
    const familyCode = c.req.param('familyCode') ?? ''
    try {
      const result = await createNegotiationRequest(c.env, {
        source,
        familyCode,
        requesterUserId: auth.session.userId,
        targetUserId: typeof body.targetUserId === 'string' ? body.targetUserId : undefined,
        preference: body.preference.trim(),
        idempotencyKey,
      })
      if (result.status === 'generating') {
        return c.json({ status: result.status, requestId: result.requestId }, 202)
      }
      if (result.status === 'recommended') {
        return c.json(
          {
            status: result.status,
            action: result.action,
            rationale: result.rationale,
            conflicts: result.conflicts,
          },
          200,
        )
      }
      return c.json(
        result.status === 'created'
          ? { status: result.status, request: result.request, conflicts: result.conflicts }
          : { status: result.status, request: result.request },
        result.status === 'created' ? 201 : 200,
      )
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })

  app.post(`${base}/:requestId/respond`, async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const auth = await currentSession(c)
    if ('response' in auth) return auth.response
    const body = await readJsonBody(c)
    if (!body || (body.answer !== 'accept' && body.answer !== 'reject')) {
      return jsonError(c, 'Answer must be accept or reject.', 400)
    }
    if (
      body.note !== undefined &&
      body.note !== null &&
      (typeof body.note !== 'string' || body.note.length > 1000)
    ) {
      return jsonError(c, 'Response note must be at most 1000 characters.', 400)
    }
    const familyCode = c.req.param('familyCode') ?? ''
    const requestId = c.req.param('requestId') ?? ''
    try {
      const result = await respondToNegotiationRequest(c.env, {
        source,
        familyCode,
        requestId,
        responderUserId: auth.session.userId,
        answer: body.answer,
        note: typeof body.note === 'string' ? body.note : null,
      })
      if (result.conflicts.length > 0) {
        try {
          await enqueueJob(
            c.env.JOB_ROOMS,
            `app:${c.env.DEEPSPACE_APP_ID}`,
            'travel-negotiation-followup',
            {
              source,
              familyCode,
              requesterUserId: auth.session.userId,
              triggerRequestId: result.request.requestId,
            },
            { maxAttempts: 3, enqueuedBy: auth.session.userId },
          )
        } catch (error) {
          console.error('Negotiation response saved, but follow-up work could not be queued.', error)
          return jsonError(
            c,
            'Your response was saved, but follow-up negotiation could not be scheduled.',
            503,
          )
        }
      }
      return c.json({
        request: result.request,
        conflicts: result.conflicts,
        followUpQueued: result.conflicts.length > 0,
      })
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })
}

export function registerTravelRoutes(app: Hono<AppContext>): void {
  for (const path of [
    '/auth/*',
    '/users/*',
    '/families/*',
    '/travel/families/*',
    '/api/preference-families/*',
  ]) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
  }
  registerNegotiationRoutes(app, '/families', 'travel-families')
  registerNegotiationRoutes(app, '/travel/families', 'travel-families')
  registerNegotiationRoutes(app, '/api/preference-families', 'families')

  app.post('/auth/start', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const body = await readJsonBody(c)
    if (!body) return jsonError(c, 'Expected a JSON request body.', 400)
    const name = body.name
    const email = body.email
    if (body.mode !== undefined && body.mode !== 'login' && body.mode !== 'signup') {
      return jsonError(c, 'Choose login or signup to continue.', 400)
    }
    const mode =
      body.mode === 'login' || (typeof name === 'string' && !name.trim()) ? 'login' : 'signup'
    if (
      mode === 'signup' &&
      (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    ) {
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
          connection: 'email',
          email: email.trim(),
          send: 'code',
        },
        undefined,
        'status',
      )
      const pending = await seal(secret, {
        email: email.trim(),
        name: mode === 'signup' && typeof name === 'string' ? name.trim() : '',
        mode,
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
      if (pending.mode === 'login' && !oldUser) {
        clearCookie(c, PENDING_COOKIE)
        return jsonError(c, 'No existing Travel Together account was found for this email.', 403)
      }
      const accountName = pending.mode === 'login' ? oldUser?.name : pending.name
      if (!accountName?.trim()) {
        clearCookie(c, PENDING_COOKIE)
        return jsonError(c, 'The saved account profile is incomplete.', 409)
      }
      const user: TravelUser = {
        userId,
        name: accountName,
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
    await Promise.all(
      user.families.map(async (familyCode) => {
        const family = await getFamily(c.env, familyCode)
        if (!family) return
        const member = family.users.find((entry) => entry.userProfile.userId === userId)
        if (!member) return
        member.userProfile.name = user.name
        await persistFamily(c.env, family)
      }),
    )
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
      user.families.map((code) => getFamily(c.env, code)),
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
    const details = body ? familyDetailsFromBody(body) : null
    if (!details) {
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
        familyCode: candidate,
        ...details,
        users: [memberFor(user)],
      }
      try {
        await createStored(c.env, familyKey(candidate), candidateFamily)
        family = candidateFamily
        break
      } catch (error) {
        if (!(await getFamily(c.env, candidate))) throw error
      }
    }
    if (!family) return jsonError(c, 'Could not create a unique family code. Try again.', 503)
    user.families = [...new Set([...user.families, family.familyCode])]
    await putStored(c.env, userKey(user.userId), user)
    return c.json({ family_code: family.familyCode })
  })

  app.post('/families/lookup', async (c) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const body = await readJsonBody(c)
    const familyCode = body?.familyCode ?? body?.family_code
    if (!validFamilyCode(familyCode)) {
      return jsonError(c, 'Enter a valid 4-digit family code.', 400)
    }
    const family = await getFamily(c.env, familyCode)
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
    const familyCode = body?.familyCode ?? body?.family_code
    if (!body || !validFamilyCode(familyCode)) {
      return jsonError(c, 'Enter a valid 4-digit family code.', 400)
    }
    if (body.userId !== result.session.userId) return jsonError(c, 'Not authorized.', 401)
    const family = await getFamily(c.env, familyCode)
    if (!family) return jsonError(c, 'That family code was not found. Check it and try again.', 404)
    const user = await getStored<TravelUser>(c.env, userKey(result.session.userId))
    if (!user) return jsonError(c, 'Sign in again to join this trip.', 401)
    if (!family.users.some((member) => member.userProfile.userId === user.userId)) {
      family.users.push(memberFor(user))
      await persistFamily(c.env, family)
    }
    user.families = [...new Set([...user.families, family.familyCode])]
    await putStored(c.env, userKey(user.userId), user)
    return c.json({ success: true })
  })

  app.put('/families/:familyId', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const code = c.req.param('familyId')
    if (!validFamilyCode(code)) return jsonError(c, 'Family not found.', 404)
    const family = await getFamily(c.env, code)
    if (!family) return jsonError(c, 'Family not found.', 404)
    const body = await readJsonBody(c)
    if (
      !body ||
      body.userId !== result.session.userId ||
      family.users[0]?.userProfile.userId !== result.session.userId
    ) {
      return jsonError(c, 'Only the trip creator can change the trip details.', 401)
    }
    const details = familyDetailsFromBody(body)
    if (!details) {
      return jsonError(c, 'Country and valid trip dates are required, and the end must be after the start.', 400)
    }
    Object.assign(family, details)
    await persistFamily(c.env, family)
    await deleteStored(c.env, planKey(code))
    return c.json({ success: true })
  })

  app.delete('/families/:familyId', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const familyCode = c.req.param('familyId')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const family = await getFamily(c.env, familyCode)
    if (!family) return jsonError(c, 'Family not found.', 404)
    if (family.users[0]?.userProfile.userId !== result.session.userId) {
      return jsonError(c, 'Only the trip creator can delete the trip.', 403)
    }

    await deleteStored(c.env, familyKey(familyCode))
    await deleteStored(c.env, planKey(familyCode))
    await Promise.all(
      family.users.map(async (member) => {
        const user = await getStored<TravelUser>(c.env, userKey(member.userProfile.userId))
        if (!user) return
        user.families = user.families.filter((code) => code !== familyCode)
        await putStored(c.env, userKey(user.userId), user)
      }),
    )
    return c.json({ success: true })
  })

  app.delete('/families/:familyId/members/:userId', async (c) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const familyCode = c.req.param('familyId')
    const userId = c.req.param('userId')
    if (!validFamilyCode(familyCode) || userId !== result.session.userId) {
      return jsonError(c, 'Not authorized.', 401)
    }
    const family = await getFamily(c.env, familyCode)
    if (!family) return jsonError(c, 'Family not found.', 404)
    if (family.users[0]?.userProfile.userId === userId) {
      return jsonError(c, "The trip creator can't leave. Delete the trip instead.", 403)
    }
    const memberIndex = family.users.findIndex(
      (member) => member.userProfile.userId === userId,
    )
    if (memberIndex < 0) return jsonError(c, 'You are not a member of this family.', 403)
    family.users.splice(memberIndex, 1)
    await persistFamily(c.env, family)

    const user = await getStored<TravelUser>(c.env, userKey(userId))
    if (user) {
      user.families = user.families.filter((code) => code !== familyCode)
      await putStored(c.env, userKey(userId), user)
    }
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
    return c.json({
      userTravelProfile: member ? frontendTravelProfile(member.userTravelProfile) : null,
    })
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
    try {
      return await withNegotiationFamilyLock(c.env, 'travel-families', familyCode, async () => {
        const access = await requireFamilyMember(c, familyCode, userId)
        if ('response' in access) return access.response
        const member = access.family.users.find((entry) => entry.userProfile.userId === userId)
        if (!member) return jsonError(c, 'Family member not found.', 404)
        member.userTravelProfile = mergeTravelProfile(
          member.userTravelProfile,
          body.userTravelProfile,
        )
        await persistFamily(c.env, access.family)
        return c.json({ success: true })
      })
    } catch (error) {
      if (error instanceof NegotiationError) return jsonError(c, error.message, error.status)
      throw error
    }
  })

  const generatePlan = async (c: Context<AppContext>) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response

    const familyId = c.req.param('familyId')
    if (!validFamilyCode(familyId)) return jsonError(c, 'Family not found.', 404)

    const body = await readJsonBody(c)
    if (!body || typeof body.requestedBy !== 'string' || !body.requestedBy.trim()) {
      return jsonError(c, 'A requesting user is required.', 400)
    }

    const family = await getFamily(c.env, familyId)
    if (!family) return jsonError(c, 'Family not found.', 404)
    const creatorId = family.users[0]?.userProfile.userId
    if (
      !creatorId ||
      body.requestedBy !== creatorId ||
      result.session.userId !== creatorId ||
      body.requestedBy !== result.session.userId
    ) {
      return jsonError(c, 'Only the trip creator can generate the plan.', 403)
    }

    const apiKey = c.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return jsonError(c, 'Trip planning is not configured.', 503)

    let interactionId: string
    try {
      interactionId = await generateTripPlan(family, apiKey)
    } catch (error) {
      console.error('Trip plan generation failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The trip planning service could not generate a plan.', 502)
    }
    const secret = sessionSecret(c.env)
    if (!secret) {
      return jsonError(c, 'Auth0 session signing is not configured. Set AUTH0_SESSION_SECRET.', 503)
    }
    const interactionToken = await seal<TripPlanToken>(secret, {
      interactionId,
      familyCode: familyId,
      userId: result.session.userId,
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
    return c.json({ interactionToken }, 202)
  }

  const pollPlan = async (c: Context<AppContext>) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response

    const familyCode = c.req.param('familyId')
    const interactionToken = c.req.param('interactionToken')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const secret = sessionSecret(c.env)
    if (!secret) {
      return jsonError(c, 'Auth0 session signing is not configured. Set AUTH0_SESSION_SECRET.', 503)
    }
    const token = await unseal<TripPlanToken>(secret, interactionToken)
    if (!token || token.familyCode !== familyCode || token.userId !== result.session.userId) {
      return jsonError(c, 'That itinerary request is invalid or expired.', 403)
    }
    const family = await getFamily(c.env, familyCode)
    if (!family) return jsonError(c, 'Family not found.', 404)
    if (family.users[0]?.userProfile.userId !== result.session.userId) {
      return jsonError(c, 'Only the trip creator can generate the plan.', 403)
    }
    const apiKey = c.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return jsonError(c, 'Trip planning is not configured.', 503)

    let response: Awaited<ReturnType<typeof getTripPlan>>
    try {
      response = await getTripPlan(token.interactionId, apiKey)
    } catch (error) {
      console.error('Trip plan status check failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The trip planning service could not retrieve the plan.', 502)
    }
    if (response.status === 'in_progress') return c.json({ status: response.status }, 202)
    if (!isGeneratedTripPlan(response.plan)) {
      console.error('Gemini returned an itinerary with an invalid shape.')
      return jsonError(c, 'The trip planning service returned an invalid plan.', 502)
    }
    try {
      await withNegotiationFamilyLock(c.env, 'travel-families', familyCode, async () => {
        await putStored(c.env, planKey(familyCode), {
          familyCode,
          format: 'backend',
          plan: response.plan,
        })
      })
    } catch (error) {
      console.error('Trip plan persistence failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The generated plan could not be saved.', 500)
    }
    return c.json(response.plan)
  }
  const generateSplit = async (c: Context<AppContext>) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response

    const familyCode = c.req.param('familyId')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const body = await readJsonBody(c)
    if (
      !body ||
      body.requestedBy !== result.session.userId ||
      typeof body.itemId !== 'string' ||
      !body.itemId ||
      body.itemId.length > 200 ||
      typeof body.dayNumber !== 'number' ||
      !Number.isInteger(body.dayNumber) ||
      body.dayNumber < 1
    ) {
      return jsonError(c, 'Expected a requesting user, day number, and activity ID.', 400)
    }
    const access = await requireFamilyMember(c, familyCode, result.session.userId)
    if ('response' in access) return access.response
    const user = access.family.users.find(
      (member) => member.userProfile.userId === result.session.userId,
    )
    if (!user) return jsonError(c, 'Family member not found.', 404)

    let submittedPlan: Record<string, unknown> | null = null
    if (body.plan !== undefined) {
      if (!isEditableTravelPlan(body.plan) || JSON.stringify(body.plan).length > 128_000) {
        return jsonError(c, 'Expected a valid itinerary to save with the split request.', 400)
      }
      submittedPlan = body.plan
      const submittedDays = Array.isArray(submittedPlan.days) ? submittedPlan.days : []
      const submittedDay = submittedDays.find(
        (entry) => isRecord(entry) && entry.dayNumber === body.dayNumber,
      )
      if (
        !submittedDay ||
        !isRecord(submittedDay) ||
        !sourceItemInDay(submittedDay, body.itemId)
      ) {
        return jsonError(c, 'The requested activity is not in the submitted itinerary.', 400)
      }
      try {
        await withNegotiationFamilyLock(c.env, 'travel-families', familyCode, async () => {
          const current = await getStored<{ familyCode: string }>(
            c.env,
            planKey(familyCode),
          )
          if (!current) {
            await putStored(c.env, planKey(familyCode), {
              familyCode,
              format: 'travel-app',
              plan: submittedPlan,
            })
          }
        })
      } catch (error) {
        console.error('Initial trip plan persistence failed.', error instanceof Error ? error.message : String(error))
        return jsonError(c, 'The itinerary could not be saved before splitting the activity.', 500)
      }
    }

    const stored = await getStored<{ familyCode: string; format?: string; plan: unknown }>(
      c.env,
      planKey(familyCode),
    )
    if (!stored) return jsonError(c, 'No saved trip plan was found.', 404)
    if (stored.familyCode !== familyCode) {
      console.error('Stored trip plan has an invalid shape for split generation.')
      return jsonError(c, 'The saved trip plan is invalid.', 500)
    }
    const editablePlan = editablePlanFromStored(stored, access.family)
    if (!editablePlan) {
      console.error('Stored trip plan has an invalid shape for split generation.')
      return jsonError(c, 'The saved trip plan is invalid.', 500)
    }
    if (!Array.isArray(editablePlan.days)) {
      return jsonError(c, 'The saved trip plan has no itinerary days.', 500)
    }
    const day = editablePlan.days
      .filter(isRecord)
      .find((entry) => entry.dayNumber === body.dayNumber)
    if (!day) return jsonError(c, 'That itinerary day was not found.', 404)
    const sourceResult = sourceItemInDay(day, body.itemId)
    if (!sourceResult) return jsonError(c, 'That activity cannot be split.', 400)
    if (
      sourceResult.split &&
      Array.isArray(sourceResult.split.groups) &&
      sourceResult.split.groups.filter(isRecord).some((group) => group.ownerId === user.userProfile.userId)
    ) {
      return jsonError(c, 'You already have a split for this activity.', 409)
    }
    const apiKey = c.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return jsonError(c, 'Trip planning is not configured.', 503)
    const secret = sessionSecret(c.env)
    if (!secret) {
      return jsonError(c, 'Auth0 session signing is not configured. Set AUTH0_SESSION_SECRET.', 503)
    }

    let interactionId: string
    try {
      interactionId = await generateTripSplit(
        {
          family: access.family,
          requestedUser: user,
          affectedDay: frontendDayForSplitPrompt(day, body.dayNumber),
          activityIds: [body.itemId],
        },
        apiKey,
      )
    } catch (error) {
      console.error('Trip split generation failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The trip planning service could not generate a split.', 502)
    }
    const interactionToken = await seal<TripSplitToken>(secret, {
      interactionId,
      familyCode,
      userId: result.session.userId,
      dayNumber: body.dayNumber,
      itemId: body.itemId,
      sourceDigest: await valueDigest(sourceResult.source),
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
    return c.json({ interactionToken }, 202)
  }
  const pollSplit = async (c: Context<AppContext>) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response

    const familyCode = c.req.param('familyId')
    const interactionToken = c.req.param('interactionToken')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const secret = sessionSecret(c.env)
    if (!secret) {
      return jsonError(c, 'Auth0 session signing is not configured. Set AUTH0_SESSION_SECRET.', 503)
    }
    const token = await unseal<TripSplitToken>(secret, interactionToken)
    if (!token || token.familyCode !== familyCode || token.userId !== result.session.userId) {
      return jsonError(c, 'That split request is invalid or expired.', 403)
    }
    const access = await requireFamilyMember(c, familyCode, result.session.userId)
    if ('response' in access) return access.response
    const user = access.family.users.find(
      (member) => member.userProfile.userId === result.session.userId,
    )
    if (!user) return jsonError(c, 'Family member not found.', 404)
    const apiKey = c.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return jsonError(c, 'Trip planning is not configured.', 503)

    let response: Awaited<ReturnType<typeof getTripPlan>>
    try {
      response = await getTripPlan(token.interactionId, apiKey)
    } catch (error) {
      console.error('Trip split status check failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The trip planning service could not retrieve the split.', 502)
    }
    if (response.status === 'in_progress') return c.json({ status: response.status }, 202)
    if (!isGeneratedSplitPatch(response.plan, token.dayNumber)) {
      console.error('Gemini returned a split patch with an invalid shape.')
      return jsonError(c, 'The trip planning service returned an invalid split.', 502)
    }

    const patchDay = (response.plan.days as Record<string, unknown>[])[0]
    const patchSplit = (patchDay.splits as Record<string, unknown>[])[0]
    try {
      return await withNegotiationFamilyLock(c.env, 'travel-families', familyCode, async () => {
        const stored = await getStored<{ familyCode: string; format?: string; plan: unknown }>(
          c.env,
          planKey(familyCode),
        )
        if (!stored || stored.familyCode !== familyCode) {
          return jsonError(c, 'The saved trip plan is no longer available.', 409)
        }
        const editablePlan = editablePlanFromStored(stored, access.family)
        if (!editablePlan) return jsonError(c, 'The saved trip plan is invalid.', 500)
        if (!Array.isArray(editablePlan.days)) {
          return jsonError(c, 'The saved trip plan has no itinerary days.', 500)
        }
        const dayIndex = editablePlan.days.findIndex(
          (day) => isRecord(day) && day.dayNumber === token.dayNumber,
        )
        if (dayIndex < 0 || !isRecord(editablePlan.days[dayIndex])) {
          return jsonError(c, 'The itinerary day changed while the split was being generated.', 409)
        }
        const day = editablePlan.days[dayIndex]
        const sourceResult = sourceItemInDay(day, token.itemId)
        if (!sourceResult) {
          if (splitAlreadyOwnedBy(day, token.itemId, result.session.userId)) {
            return c.json({ format: 'travel-app', plan: editablePlan })
          }
          return jsonError(c, 'The activity changed while the split was being generated. Reload the itinerary and try again.', 409)
        }
        if ((await valueDigest(sourceResult.source)) !== token.sourceDigest) {
          return jsonError(c, 'The activity changed while the split was being generated. Reload the itinerary and try again.', 409)
        }
        if (
          sourceResult.split &&
          Array.isArray(sourceResult.split.groups) &&
          sourceResult.split.groups.filter(isRecord).some((group) => group.ownerId === result.session.userId)
        ) {
          return c.json({ format: 'travel-app', plan: editablePlan })
        }

        const updatedPlan = mergeGeneratedSplit(
          editablePlan,
          dayIndex,
          token.itemId,
          user,
          patchSplit,
        )
        await putStored(c.env, planKey(familyCode), {
          familyCode,
          format: 'travel-app',
          plan: updatedPlan,
        })
        return c.json({ format: 'travel-app', plan: updatedPlan })
      })
    } catch (error) {
      console.error('Trip split persistence failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The generated split could not be saved.', 500)
    }
  }
  const getSavedPlan = async (c: Context<AppContext>) => {
    const result = await currentSession(c)
    if ('response' in result) return result.response

    const familyCode = c.req.param('familyId')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const access = await requireFamilyMember(c, familyCode, result.session.userId)
    if ('response' in access) return access.response

    const stored = await getStored<{ familyCode: string; format?: string; plan: unknown }>(
      c.env,
      planKey(familyCode),
    )
    if (!stored) return jsonError(c, 'No saved trip plan was found.', 404)
    if (
      stored.familyCode !== familyCode ||
      (stored.format === 'travel-app'
        ? !isEditableTravelPlan(stored.plan)
        : !isGeneratedTripPlan(stored.plan))
    ) {
      console.error('Stored trip plan has an invalid shape.')
      return jsonError(c, 'The saved trip plan is invalid.', 500)
    }
    if (stored.format === 'travel-app') {
      return c.json({ format: stored.format, plan: stored.plan })
    }
    return c.json(stored.plan)
  }
  const updateSavedPlan = async (c: Context<AppContext>) => {
    if (!isSameOrigin(c)) return jsonError(c, 'Requests must come from this app.', 401)
    const result = await currentSession(c)
    if ('response' in result) return result.response
    const familyCode = c.req.param('familyId')
    if (!validFamilyCode(familyCode)) return jsonError(c, 'Family not found.', 404)
    const access = await requireFamilyMember(c, familyCode, result.session.userId)
    if ('response' in access) return access.response
    const body = await readJsonBody(c)
    if (!body || !isEditableTravelPlan(body.plan)) {
      return jsonError(c, 'Expected a valid itinerary.', 400)
    }
    const submittedPlan = body.plan
    if (JSON.stringify(submittedPlan).length > 128_000) {
      return jsonError(c, 'The itinerary is too large to save.', 400)
    }
    const rawRemovedGroupIds = body.removedSplitGroupIds
    if (
      rawRemovedGroupIds !== undefined &&
      (!Array.isArray(rawRemovedGroupIds) ||
        rawRemovedGroupIds.length > 100 ||
        !rawRemovedGroupIds.every((id) => typeof id === 'string' && id.length <= 200))
    ) {
      return jsonError(c, 'Expected valid removed split group IDs.', 400)
    }
    const removedGroupIds: string[] = Array.isArray(rawRemovedGroupIds)
      ? rawRemovedGroupIds.filter((id): id is string => typeof id === 'string')
      : []
    try {
      return await withNegotiationFamilyLock(c.env, 'travel-families', familyCode, async () => {
        const stored = await getStored<{ familyCode: string; format?: string; plan: unknown }>(
          c.env,
          planKey(familyCode),
        )
        let plan = submittedPlan
        if (stored) {
          if (stored.familyCode !== familyCode) {
            return jsonError(c, 'The saved trip plan is invalid.', 500)
          }
          const savedPlan = editablePlanFromStored(stored, access.family)
          if (!savedPlan) return jsonError(c, 'The saved trip plan is invalid.', 500)
          plan = preserveSharedSplits(
            savedPlan,
            submittedPlan,
            result.session.userId,
            new Set(removedGroupIds),
          )
        }
        await putStored(c.env, planKey(familyCode), {
          familyCode,
          format: 'travel-app',
          plan,
        })
        return c.json({ success: true, format: 'travel-app', plan })
      })
    } catch (error) {
      console.error('Trip plan persistence failed.', error instanceof Error ? error.message : String(error))
      return jsonError(c, 'The itinerary could not be saved.', 500)
    }
  }
  app.post('/families/:familyId/plan', generatePlan)
  app.get('/families/:familyId/plan', getSavedPlan)
  app.put('/families/:familyId/plan', updateSavedPlan)
  app.get('/families/:familyId/plan/:interactionToken', pollPlan)
  app.post('/families/:familyId/plan/splits', generateSplit)
  app.get('/families/:familyId/plan/splits/:interactionToken', pollSplit)
  app.post('/travel/families/:familyId/plan', generatePlan)
  app.get('/travel/families/:familyId/plan', getSavedPlan)
  app.put('/travel/families/:familyId/plan', updateSavedPlan)
  app.get('/travel/families/:familyId/plan/:interactionToken', pollPlan)
  app.post('/travel/families/:familyId/plan/splits', generateSplit)
  app.get('/travel/families/:familyId/plan/splits/:interactionToken', pollSplit)
}
