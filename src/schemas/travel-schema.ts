import type { CollectionSchema } from 'deepspace/schema'

const privatePermissions = {
  '*': { read: false, create: false, update: false, delete: false },
  viewer: { read: false, create: false, update: false, delete: false },
  member: { read: false, create: false, update: false, delete: false },
  admin: { read: false, create: false, update: false, delete: false },
}

export const travelUsersSchema: CollectionSchema = {
  name: 'travel-users',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'email', storage: 'text', interpretation: 'email', required: true },
    { name: 'emailVerified', storage: 'number', interpretation: 'boolean', required: true },
    { name: 'avatar', storage: 'text', interpretation: 'plain', required: true },
    { name: 'families', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  permissions: privatePermissions,
}

export const travelFamiliesSchema: CollectionSchema = {
  name: 'travel-families',
  columns: [
    { name: 'familyCode', storage: 'text', interpretation: 'plain', required: true },
    { name: 'country', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startDate', storage: 'text', interpretation: 'plain', required: true },
    { name: 'endDate', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startTime', storage: 'text', interpretation: 'plain', required: true },
    { name: 'endTime', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startCity', storage: 'text', interpretation: 'plain', required: false },
    { name: 'endCity', storage: 'text', interpretation: 'plain', required: false },
    { name: 'users', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  uniqueOn: ['familyCode'],
  permissions: privatePermissions,
}

export const travelPlansSchema: CollectionSchema = {
  name: 'travel-plans',
  columns: [
    { name: 'familyCode', storage: 'text', interpretation: 'plain', required: true },
    { name: 'format', storage: 'text', interpretation: 'plain', required: false },
    { name: 'plan', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  uniqueOn: ['familyCode'],
  permissions: privatePermissions,
}
