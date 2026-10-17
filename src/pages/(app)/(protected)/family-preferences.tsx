import { useRef, useState, type FormEvent } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import {
  parseUserPreference,
  upsertUserPreference,
  type FamilyRecord,
} from '@/lib/family-preferences'

export default function FamilyPreferencesPage() {
  const [familyCodeInput, setFamilyCodeInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const familyCode = familyCodeInput.trim()
  const { records, status, error: queryError } = useQuery<FamilyRecord>('families', {
    where: { familyCode },
    limit: 1,
  })
  const { ready, createConfirmed, putConfirmed } = useMutations<FamilyRecord>('families')

  async function uploadPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')

    if (!familyCode || !file) {
      setError('Enter a family code and select a user-preference JSON file.')
      return
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(await file.text())
    } catch {
      setError('The selected file is not valid JSON.')
      return
    }

    const preference = parseUserPreference(decoded)
    if (!preference) {
      setError('The file must contain userProfile and userTravelProfile objects.')
      return
    }
    if (!ready || status !== 'ready') {
      setError('Family storage is still connecting. Try again when it is ready.')
      return
    }

    setBusy(true)
    try {
      const existingFamily = records.find((record) => record.data.familyCode === familyCode)
      const users = upsertUserPreference(existingFamily?.data.users ?? [], preference)

      if (existingFamily) {
        await putConfirmed(existingFamily.recordId, { users })
      } else {
        await createConfirmed({ familyCode, users })
      }

      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setMessage(
        `Saved ${preference.userProfile.name || preference.userProfile.userId}. The family now has ${users.length} preference${users.length === 1 ? '' : 's'}.`,
      )
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : String(cause)} If this family already exists, only its group leader can update it.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Family preferences</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Add a local user-preference JSON file to the cloud family record. Preferences are
          grouped by family code; uploading the same user again replaces their previous entry.
        </p>

        <form
          className="mt-8 space-y-5 rounded-lg border border-border bg-card p-6"
          onSubmit={uploadPreference}
        >
          <label className="block space-y-2 text-sm font-medium">
            Family code
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
              value={familyCodeInput}
              onChange={(event) => setFamilyCodeInput(event.target.value)}
              maxLength={128}
              required
            />
          </label>

          <label className="block space-y-2 text-sm font-medium">
            User-preference JSON
            <input
              ref={fileInput}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground"
              type="file"
              accept=".json,application/json"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>

          {status === 'error' && (
            <p role="alert" className="text-sm text-destructive">
              Could not load family data: {queryError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-foreground">
              {message}
            </p>
          )}

          <Button type="submit" disabled={!ready || status !== 'ready' || busy}>
            {busy ? 'Saving…' : 'Add preference to family'}
          </Button>
          <p className="text-xs text-muted-foreground">
            The first confirmed upload creates the family record and makes its uploader the
            group leader. Only that account can change the cloud family JSON afterward.
          </p>
        </form>
      </div>
    </div>
  )
}
