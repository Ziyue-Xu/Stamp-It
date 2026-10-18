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
  sessionId?: string
}

export interface NegotiationConflict {
  preference: string
  resolution: 'negotiate' | 'accommodate' | 'split' | 'review'
  users: Array<{ userId: string; name: string; value: unknown }>
}

export function getNegotiationStatus(familyId: string): Promise<{
  familyCode: string
  conflicts: NegotiationConflict[]
  requests: NegotiationRequest[]
  resolvedPreferences: Record<string, string>
  balanced: boolean
  questionLimitReached: boolean
  sessionStatus: 'awaiting_consent' | 'active' | 'completed' | 'limit_reached'
  sessionId: string | null
  sessionQuestionCount: number
  sessionQuestionLimit: number
}>

export function startNegotiationSession(familyId: string): Promise<{
  familyCode: string
  sessionStatus: 'active' | 'completed' | 'limit_reached'
  sessionId: string | null
  sessionQuestionCount: number
  sessionQuestionLimit: number
  conflicts: NegotiationConflict[]
  requests: NegotiationRequest[]
  resolvedPreferences: Record<string, string>
  balanced: boolean
  questionLimitReached: boolean
}>

export function createNegotiationRequest(input: {
  familyId: string
  preference: string
  targetUserId: string
  idempotencyKey: string
}): Promise<
  | { status: 'created' | 'existing'; request: NegotiationRequest }
  | {
      status: 'recommended'
      action: string
      rationale: string
      conflicts: NegotiationConflict[]
    }
  | { status: 'generating'; requestId: string }
>

export function respondToNegotiationRequest(input: {
  familyId: string
  requestId: string
  answer: 'accept' | 'reject'
}): Promise<{
  request: NegotiationRequest
  conflicts: NegotiationConflict[]
  followUpQueued: boolean
}>
