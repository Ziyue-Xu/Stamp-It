import type { CollectionSchema } from 'deepspace/schema'

export const familiesSchema: CollectionSchema = {
  name: 'families',
  columns: [
    { name: 'familyCode', storage: 'text', interpretation: 'plain', required: true },
    { name: 'users', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'negotiationState', storage: 'text', interpretation: { kind: 'json' }, required: false },
  ],
  uniqueOn: ['familyCode'],
  permissions: {
    viewer: { read: 'own', create: true, update: 'own', delete: false },
    member: { read: 'own', create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
