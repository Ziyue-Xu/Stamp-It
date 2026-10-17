import { useEffect, useState } from 'react'
import WelcomeScreen from '../my-travel-app/src/screens/WelcomeScreen.jsx'
import SignUpScreen from '../my-travel-app/src/screens/SignUpScreen.jsx'
import CreateTripScreen from '../my-travel-app/src/screens/CreateTripScreen.jsx'
import JoinCodeScreen from '../my-travel-app/src/screens/JoinCodeScreen.jsx'
import ShareCodeScreen from '../my-travel-app/src/screens/ShareCodeScreen.jsx'
import PreferencesScreen from '../my-travel-app/src/screens/PreferencesScreen.jsx'
import { createTrip, joinTrip } from '../my-travel-app/src/api/tripApi.js'
import { saveProfile } from '../my-travel-app/src/api/profileApi.js'
import { getTravelProfile } from '../my-travel-app/src/api/preferencesApi.js'

export default function TravelApp() {
  const [page, setPage] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [trip, setTrip] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [intent, setIntent] = useState('create')
  const [savedProfile, setSavedProfile] = useState(null)

  useEffect(() => {
    let active = true
    fetch('/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (!active) return
        if (session?.user?.userId) setProfile(session.user)
        setPage('welcome')
      })
      .catch(() => {
        if (active) setPage('welcome')
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSignIn(account) {
    const saved = { ...account, avatar: account.avatar || 'taj' }
    await saveProfile(saved)
    setProfile(saved)
    setPage(intent === 'join' ? 'join' : 'create')
  }

  async function handleCreate(details) {
    const created = await createTrip({ ...details, destinationId: selectedId })
    const readyTrip = {
      ...created,
      creatorId: profile.userId,
      members: [
        {
          userId: profile.userId,
          name: profile.name,
          email: profile.email,
          avatar: profile.avatar,
        },
      ],
    }
    setTrip(readyTrip)
    setPage('share')
  }

  async function handleFindTrip(foundTrip) {
    const member = {
      userId: profile.userId,
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar,
    }
    await joinTrip(foundTrip, member)
    setTrip({
      ...foundTrip,
      members: foundTrip.members.some((entry) => entry.userId === member.userId)
        ? foundTrip.members
        : [...foundTrip.members, member],
    })
    setPage('preferences')
  }

  async function handleDone() {
    setSavedProfile(await getTravelProfile(profile.userId, trip.familyId))
    setPage('done')
  }

  if (page === 'loading') {
    return <div className="min-h-screen bg-[#f7f2e8]" aria-busy="true" />
  }
  if (page === 'welcome') {
    return (
      <WelcomeScreen
        onStartTrip={() => {
          setIntent('create')
          setSelectedId('')
          setPage(profile ? 'create' : 'signup')
        }}
        onJoinTrip={() => {
          setIntent('join')
          setPage(profile ? 'join' : 'signup')
        }}
      />
    )
  }
  if (page === 'signup') {
    return <SignUpScreen onSave={handleSignIn} onBack={() => setPage('welcome')} />
  }
  if (page === 'create') {
    return (
      <CreateTripScreen
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
        onBack={() => setPage('welcome')}
      />
    )
  }
  if (page === 'join') {
    return <JoinCodeScreen onFound={handleFindTrip} onBack={() => setPage('welcome')} />
  }
  if (page === 'share') {
    return <ShareCodeScreen trip={trip} onContinue={() => setPage('preferences')} />
  }
  if (page === 'preferences') {
    return <PreferencesScreen profile={profile} trip={trip} onDone={handleDone} />
  }
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Your travel preferences are saved</h1>
      <pre className="mt-4 overflow-auto rounded bg-white p-4 text-sm">
        {JSON.stringify(savedProfile, null, 2)}
      </pre>
      <button
        className="mt-4 rounded bg-black px-4 py-2 text-white"
        onClick={() => {
          setTrip(null)
          setPage('welcome')
        }}
      >
        Continue
      </button>
    </main>
  )
}
