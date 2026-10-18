/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every
 * job picked up from the queue. Dispatch on `job.type` and return a
 * result (captured as `job.result`) or throw to fail (retried up to
 * `maxAttempts`, then permanently marked failed).
 *
 * Use this for any work that needs to outlive the HTTP response:
 *   - AI generation that exceeds Cloudflare's 30-second waitUntil window
 *   - Export / render pipelines
 *   - Bulk imports, fan-out side effects
 *
 * Enqueue from a client with the `useJobs(roomId)` hook, or from
 * worker-side code (an HTTP route, an action, a cron task) with
 * `enqueueJob(env.JOB_ROOMS, \`app:${env.DEEPSPACE_APP_ID}\`, type, payload)`.
 *
 * Long-running progress / checkpoint guidance:
 *   - `ctx.progress(0..1, msg?)` publishes a real-time update over the
 *     room's WebSocket so subscribers see progress without polling.
 *   - `ctx.continue(state, { afterMs })` yields and resumes on the next
 *     alarm with `job.resumeFrom = state` — use this for work that
 *     exceeds the 15-minute per-alarm wall-time ceiling.
 *   - `ctx.signal` is an AbortSignal that fires when a client cancels;
 *     forward it to `fetch` and check `.aborted` at loop suspension
 *     points.
 *
 * Example:
 *
 *   export async function runJob(job: Job, ctx: JobContext, env: Env) {
 *     switch (job.type) {
 *       case 'ai-summarize': {
 *         const { text } = job.payload as { text: string }
 *         ctx.progress(0.1, 'starting')
 *         const summary = await summarize(text, { signal: ctx.signal })
 *         return { summary }
 *       }
 *       default:
 *         throw new Error(`Unknown job type: ${job.type}`)
 *     }
 *   }
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { automaticallyCreateNegotiationRequests } from './server/negotiation-store.js'

export async function runJob(
  job: Job,
  ctx: JobContext,
  env: Env,
): Promise<unknown> {
  if (job.type === 'travel-negotiation-followup') {
    const payload = job.payload
    if (
      payload === null ||
      typeof payload !== 'object' ||
      !('source' in payload) ||
      !('familyCode' in payload) ||
      !('requesterUserId' in payload) ||
      !('triggerRequestId' in payload)
    ) {
      throw new Error('Negotiation follow-up job has an invalid payload.')
    }
    const source = payload.source
    const familyCode = payload.familyCode
    const requesterUserId = payload.requesterUserId
    const triggerRequestId = payload.triggerRequestId
    if (
      (source !== 'families' && source !== 'travel-families') ||
      typeof familyCode !== 'string' ||
      typeof requesterUserId !== 'string' ||
      typeof triggerRequestId !== 'string'
    ) {
      throw new Error('Negotiation follow-up job has an invalid payload.')
    }
    await ctx.progress(0.1, 'Checking the updated family preferences.')
    const result = await automaticallyCreateNegotiationRequests(env, {
      source,
      familyCode,
      requesterUserId,
      triggerRequestId,
    })
    await ctx.progress(1, 'Negotiation follow-up complete.')
    return result
  }
  throw new Error(`Unknown job type: ${job.type}`)
}
