import type { CollectionSchema } from 'deepspace/schema'

export const negotiationLocksSchema: CollectionSchema = {
  name: 'negotiation-locks',
  columns: [
    { name: 'lockKey', storage: 'text', interpretation: 'plain', required: true },
    { name: 'token', storage: 'text', interpretation: 'plain', required: true },
    { name: 'expiresAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['lockKey'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
