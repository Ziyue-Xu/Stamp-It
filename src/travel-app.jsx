import { useEffect, useState } from 'react'
import WelcomeScreen from '../my-travel-app/src/screens/WelcomeScreen.jsx'
import SignUpScreen from '../my-travel-app/src/screens/SignUpScreen.jsx'
import CreateTripScreen from '../my-travel-app/src/screens/CreateTripScreen.jsx'
import JoinCodeScreen from '../my-travel-app/src/screens/JoinCodeScreen.jsx'
import ShareCodeScreen from '../my-travel-app/src/screens/ShareCodeScreen.jsx'
import PreferencesScreen from '../my-travel-app/src/screens/PreferencesScreen.jsx'
import DashboardScreen from '../my-travel-app/src/screens/DashboardScreen.jsx'
import AccountScreen from '../my-travel-app/src/screens/AccountScreen.jsx'
import TripScreen from '../my-travel-app/src/screens/TripScreen.jsx'
import PlanScreen from '../my-travel-app/src/screens/PlanScreen.jsx'
import { home } from '../my-travel-app/src/themes/home.js'
import { findDestination } from '../my-travel-app/src/data/destinations.js'
import { hasAnyAnswer, answersFromTravelProfile } from '../my-travel-app/src/data/preferenceQuestions.js'
import {
  createTrip,
  deleteTrip,
  getCreatorId,
  getMyTrips,
  leaveTrip,
  joinTrip,
  updateTrip,
} from '../my-travel-app/src/api/tripApi.js'
import { clearProfile, saveProfile } from '../my-travel-app/src/api/profileApi.js'
import { getTravelProfile } from '../my-travel-app/src/api/preferencesApi.js'
import { planFromBackend } from '../my-travel-app/src/api/planFormat.js'

async function travelPlanRequest(path, init, { allowNotFound = false } = {}) {
  const response = await fetch(path, init)
  if (!response.ok && response.status !== 202 && !(allowNotFound && response.status === 404)) {
    let error = 'Could not generate the plan. Please try again.'
    try {
      const data = await response.json()
      error = data.error || data.message || error
    } catch {
      // Keep the user-facing fallback for non-JSON server errors.
    }
    throw new Error(error)
  }
  return response
}

async function generateGroupPlan(familyId, requestedByUserId, trip, forceRegenerate = false) {
  const familyPath = `/families/${encodeURIComponent(familyId)}`
  if (!forceRegenerate) {
    const saved = await travelPlanRequest(`${familyPath}/plan`, undefined, { allowNotFound: true })
    if (saved.ok) {
      const data = await saved.json()
      return {
        plan:
          data.format === 'travel-app'
            ? data.plan
            : planFromBackend(data, trip.members),
      }
    }
  }

  const start = await travelPlanRequest(`${familyPath}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedBy: requestedByUserId }),
  })
  const { interactionToken } = await start.json()
  if (typeof interactionToken !== 'string' || !interactionToken) {
    throw new Error('The trip planning service returned an invalid request token.')
  }

  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const response = await travelPlanRequest(
      `${familyPath}/plan/${encodeURIComponent(interactionToken)}`,
    )
    if (response.status === 202) continue
    return { plan: planFromBackend(await response.json(), trip.members) }
  }

  throw new Error('Plan generation is taking longer than expected. Please try again.')
}

async function getSavedGroupPlan(familyId, trip) {
  const path = `/families/${encodeURIComponent(familyId)}/plan`
  const response = await travelPlanRequest(path, undefined, { allowNotFound: true })
  if (response.status === 404) return null
  const data = await response.json()
  return data.format === 'travel-app' ? data.plan : planFromBackend(data, trip.members)
}

async function saveGroupPlan(familyId, userId, plan) {
  await travelPlanRequest(`/families/${encodeURIComponent(familyId)}/plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updatedBy: userId, plan }),
  })
  return 'server'
}

export default function TravelApp() {
  const [screen, setScreen] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [trips, setTrips] = useState([])
  const [trip, setTrip] = useState(null)
  const [destinationId, setDestinationId] = useState(null)
  const [savedAnswers, setSavedAnswers] = useState(null)
  const [hasTripPreferences, setHasTripPreferences] = useState(false)
  const [plan, setPlan] = useState(null)
  const [intent, setIntent] = useState('create')
  const [pageError, setPageError] = useState('')

  const destination = findDestination(destinationId)
  const theme = destination ? destination.theme : home

  async function showDashboard(person) {
    const myTrips = await getMyTrips(person.userId)
    setTrips(myTrips)
    setTrip(null)
    setDestinationId(null)
    setSavedAnswers(null)
    setHasTripPreferences(false)
    setPlan(null)
    setScreen('dashboard')
  }

  useEffect(() => {
    let active = true
    async function loadSession() {
      try {
        const response = await fetch('/auth/me')
        if (response.status === 401) {
          if (active) setScreen('welcome')
          return
        }
        if (!response.ok) throw new Error('Could not check your sign-in. Refresh and try again.')
        const data = await response.json()
        if (!active) return
        if (data.user?.userId) {
          const saved = { ...data.user, avatar: data.user.avatar || 'taj' }
          await saveProfile(saved)
          setProfile(saved)
          await showDashboard(saved)
        } else {
          setScreen('welcome')
        }
      } catch (error) {
        if (active) {
          setPageError(error instanceof Error ? error.message : 'Could not load the app.')
          setScreen('welcome')
        }
      }
    }
    void loadSession()
    return () => {
      active = false
    }
  }, [])

  async function goHome() {
    setPageError('')
    if (profile) {
      try {
        await showDashboard(profile)
      } catch (error) {
        setPageError(error instanceof Error ? error.message : 'Could not load your trips.')
      }
    } else {
      setTrip(null)
      setDestinationId(null)
      setScreen('welcome')
    }
  }

  function handleNewTrip() {
    setPageError('')
    setIntent('create')
    setDestinationId(null)
    setScreen(profile ? 'create' : 'signup')
  }

  function handleJoinTrip() {
    setPageError('')
    setIntent('join')
    setScreen(profile ? 'join' : 'signup')
  }

  function handleLogin() {
    setPageError('')
    setIntent('login')
    setScreen('signup')
  }

  async function handleSignedIn(signedInProfile) {
    const response = await fetch('/auth/me')
    if (!response.ok) throw new Error('Sign-in completed, but your profile could not be loaded.')
    const data = await response.json()
    const saved = { ...signedInProfile, ...data.user, avatar: data.user?.avatar || 'taj' }
    await saveProfile(saved)
    setProfile(saved)
    setPageError('')
    if (intent === 'login') {
      await showDashboard(saved)
    } else if (intent === 'join') {
      setScreen('join')
    } else {
      setScreen('create')
    }
  }

  async function handleCreateTrip(details) {
    const created = await createTrip({ ...details, destinationId })
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
    setPlan(null)
    setScreen('share')
  }

  async function getJoinedTrip(joinedTrip) {
    const updatedTrip = await joinTrip(joinedTrip, profile)
    const myTrips = await getMyTrips(profile.userId)
    setTrips(myTrips)
    return myTrips.find((item) => item.familyId === joinedTrip.familyId) || updatedTrip
  }

  async function goToPreferencesOrDashboard(person, selectedTrip) {
    const existing = await getTravelProfile(person.userId, selectedTrip.familyId)
    if (existing && hasAnyAnswer(existing)) {
      await showDashboard(person)
      return
    }
    setTrip(selectedTrip)
    setDestinationId(selectedTrip.destinationId)
    setSavedAnswers(null)
    setHasTripPreferences(false)
    setScreen('preferences')
  }

  async function handleShareContinue() {
    if (!profile || !trip) return
    try {
      const joinedTrip = await getJoinedTrip(trip)
      await goToPreferencesOrDashboard(profile, joinedTrip)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not continue to your trip.')
    }
  }

  async function handleTripFound(foundTrip) {
    const joinedTrip = await getJoinedTrip(foundTrip)
    await goToPreferencesOrDashboard(profile, joinedTrip)
  }

  async function handlePreferencesDone() {
    if (savedAnswers && trip && profile) {
      const saved = await getTravelProfile(profile.userId, trip.familyId)
      setHasTripPreferences(Boolean(saved && hasAnyAnswer(saved)))
      setSavedAnswers(null)
      setScreen('trip')
    } else if (profile) {
      await showDashboard(profile)
    }
  }

  function handleCancelPreferences() {
    setSavedAnswers(null)
    setScreen('trip')
  }

  async function handleEditPreferences() {
    if (!profile || !trip) return
    try {
      const saved = await getTravelProfile(profile.userId, trip.familyId)
      setSavedAnswers(answersFromTravelProfile(saved))
      setScreen('preferences')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not load your preferences.')
    }
  }

  async function handleOpenTrip(chosenTrip) {
    try {
      const [saved, savedPlan] = await Promise.all([
        getTravelProfile(profile.userId, chosenTrip.familyId),
        getSavedGroupPlan(chosenTrip.familyId, chosenTrip),
      ])
      setHasTripPreferences(Boolean(saved && hasAnyAnswer(saved)))
      setTrip(chosenTrip)
      setDestinationId(chosenTrip.destinationId)
      setPlan(savedPlan)
      setScreen('trip')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not open this trip.')
    }
  }

  function handleEditTrip() {
    if (!trip || !profile || getCreatorId(trip) !== profile.userId) return
    setDestinationId(trip.destinationId)
    setScreen('editTrip')
  }

  function handleCancelEditTrip() {
    setDestinationId(trip.destinationId)
    setScreen('trip')
  }

  async function handleUpdateTrip(details) {
    const updated = await updateTrip(
      trip,
      { ...details, destinationId },
      profile.userId,
    )
    setTrip(updated)
    setTrips((current) => current.map((item) => (
      item.familyId === updated.familyId ? { ...item, ...updated } : item
    )))
    setPlan(null)
    setDestinationId(updated.destinationId)
    setScreen('trip')
  }

  async function handleSaveAccount(changes) {
    const response = await fetch(`/users/${encodeURIComponent(profile.userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: changes.name, avatar: changes.avatar }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || 'Could not save your profile. Please try again.')
    }
    const updated = { ...profile, ...changes }
    await saveProfile(updated)
    setProfile(updated)
    setTrips((current) => current.map((item) => ({
      ...item,
      members: item.members.map((member) => (
        member.userId === updated.userId ? { ...member, ...updated } : member
      )),
    })))
  }

  async function handleSignOut() {
    try {
      const response = await fetch('/auth/sign-out', { method: 'POST' })
      if (!response.ok) throw new Error('Could not sign out. Please try again.')
      await clearProfile()
      setProfile(null)
      setTrips([])
      setTrip(null)
      setDestinationId(null)
      setSavedAnswers(null)
      setHasTripPreferences(false)
      setPlan(null)
      setScreen('welcome')
      setPageError('')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  async function handleGeneratePlan(forceRegenerate = false) {
    const result = await generateGroupPlan(trip.familyId, profile.userId, trip, forceRegenerate)
    if (result.plan) {
      setPlan(result.plan)
      setScreen('plan')
    }
    return result
  }

  async function handleDeleteCurrentTrip() {
    await deleteTrip(trip, profile.userId)
    await showDashboard(profile)
  }

  async function handleLeaveCurrentTrip() {
    await leaveTrip(trip, profile.userId)
    await showDashboard(profile)
  }

  const colors = {
    '--paper': theme.paper,
    '--ink': theme.ink,
    '--ink-soft': theme.inkSoft,
    '--sky': theme.sky,
    '--terracotta': theme.terracotta,
    '--gold': theme.gold,
    '--teal': theme.teal,
    '--pink': theme.pink,
    '--gold-soft': theme.goldSoft,
    '--teal-soft': theme.tealSoft,
    '--green-soft': theme.greenSoft,
  }

  return (
    <div className="app" style={colors}>
      {pageError && (
        <p role="alert" className="form-error" onClick={() => setPageError('')}>
          {pageError}
        </p>
      )}
      {screen === 'welcome' && (
        <WelcomeScreen
          onStartTrip={handleNewTrip}
          onJoinTrip={handleJoinTrip}
          onLogin={handleLogin}
        />
      )}
      {screen === 'signup' && (
        <SignUpScreen
          mode={intent === 'login' ? 'login' : 'signup'}
          onSave={handleSignedIn}
          onBack={goHome}
        />
      )}
      {screen === 'create' && (
        <CreateTripScreen
          selectedId={destinationId}
          onSelect={setDestinationId}
          onCreate={handleCreateTrip}
          onBack={goHome}
        />
      )}
      {screen === 'editTrip' && trip && profile && (
        <CreateTripScreen
          initialTrip={trip}
          selectedId={destinationId}
          onSelect={setDestinationId}
          onSave={handleUpdateTrip}
          onBack={handleCancelEditTrip}
        />
      )}
      {screen === 'share' && trip && (
        <ShareCodeScreen trip={trip} onContinue={handleShareContinue} />
      )}
      {screen === 'join' && (
        <JoinCodeScreen onFound={handleTripFound} onBack={goHome} />
      )}
      {screen === 'preferences' && profile && trip && (
        <PreferencesScreen
          profile={profile}
          trip={trip}
          initialAnswers={savedAnswers}
          onDone={handlePreferencesDone}
          onCancel={savedAnswers ? handleCancelPreferences : null}
        />
      )}
      {screen === 'dashboard' && profile && (
        <DashboardScreen
          profile={profile}
          trips={trips}
          onNewTrip={handleNewTrip}
          onJoinTrip={handleJoinTrip}
          onOpenTrip={handleOpenTrip}
          onOpenAccount={() => setScreen('account')}
          onSignOut={handleSignOut}
        />
      )}
      {screen === 'account' && profile && (
        <AccountScreen
          profile={profile}
          onSave={handleSaveAccount}
          onBack={() => showDashboard(profile).catch((error) => {
            setPageError(error instanceof Error ? error.message : 'Could not load your trips.')
          })}
          onSignOut={handleSignOut}
        />
      )}
      {screen === 'trip' && trip && profile && (
        <TripScreen
          trip={trip}
          profile={profile}
          hasPreferences={hasTripPreferences}
          onBack={() => showDashboard(profile).catch((error) => {
            setPageError(error instanceof Error ? error.message : 'Could not load your trips.')
          })}
          onEditPreferences={handleEditPreferences}
          onEditTrip={handleEditTrip}
          onGeneratePlan={handleGeneratePlan}
          hasPlan={Boolean(plan)}
          onViewPlan={() => setScreen('plan')}
          onDeleteTrip={handleDeleteCurrentTrip}
          onLeaveTrip={handleLeaveCurrentTrip}
        />
      )}
      {screen === 'plan' && plan && trip && (
        <PlanScreen
          plan={plan}
          trip={trip}
          profile={profile}
          onPlanChange={setPlan}
          onSavePlan={(updatedPlan) => saveGroupPlan(trip.familyId, profile.userId, updatedPlan)}
          onReload={async () => {
            const latestPlan = await getSavedGroupPlan(trip.familyId, trip)
            if (!latestPlan) throw new Error('No saved trip plan was found.')
            setPlan(latestPlan)
          }}
          onRegenerate={() => handleGeneratePlan(true)}
          onBack={() => setScreen('trip')}
        />
      )}
    </div>
  )
}
