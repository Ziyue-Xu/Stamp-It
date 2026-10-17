import { useState, useEffect } from "react";
import { home } from "./themes/home";
import { findDestination } from "./data/destinations";
import WelcomeScreen from "./screens/WelcomeScreen";
import CreateTripScreen from "./screens/CreateTripScreen";
import ShareCodeScreen from "./screens/ShareCodeScreen";
import JoinCodeScreen from "./screens/JoinCodeScreen";
import SignUpScreen from "./screens/SignUpScreen";
import PreferencesScreen from "./screens/PreferencesScreen";
import DashboardScreen from "./screens/DashboardScreen";
import AccountScreen from "./screens/AccountScreen";
import TripScreen from "./screens/TripScreen";
import PlanScreen from "./screens/PlanScreen";
import {
  getProfile,
  saveProfile,
  clearProfile,
  updateProfile,
} from "./api/profileApi";
import {
  createTrip,
  addMemberToTrip,
  joinTrip,
  getMyTrips,
  refreshMemberInTrips,
  updateTrip,
  deleteTrip,
  leaveTrip,
  getCreatorId,
} from "./api/tripApi";
import { getTravelProfile } from "./api/preferencesApi";
import { hasAnyAnswer, answersFromTravelProfile } from "./data/preferenceQuestions";
import { generateGroupPlan, getExistingPlan } from "./api/planApi";

function App() {
  const [screen, setScreen] = useState("loading");

  const [destinationId, setDestinationId] = useState(null);

  const [trip, setTrip] = useState(null);

  const [profile, setProfile] = useState(null);

  const [trips, setTrips] = useState([]);

  const [savedAnswers, setSavedAnswers] = useState(null);

  const [hasTripPreferences, setHasTripPreferences] = useState(false);

  const [plan, setPlan] = useState(null);

  const currentFamilyId = trip ? trip.familyId : null;
  useEffect(() => {
    let stale = false;
    setPlan(null);
    if (currentFamilyId) {
      getExistingPlan(currentFamilyId, trip).then((result) => {
        if (!stale && result.plan) setPlan(result.plan);
      });
    }
    return () => {
      stale = true;
    };
  }, [currentFamilyId]);

  const destination = findDestination(destinationId);
  const theme = destination ? destination.theme : home;

  async function showDashboard(person) {
    let myTrips = [];
    try {
      myTrips = await getMyTrips(person.userId);
    } catch (error) {
      console.log("Could not load trips", error);
    }
    setTrips(myTrips);
    setTrip(null);
    setDestinationId(null);
    setSavedAnswers(null);
    setScreen("dashboard");
  }

  async function goToPreferencesOrDashboard(person, tripToUse) {
    const existing = await getTravelProfile(person.userId, tripToUse.familyId);
    if (existing && hasAnyAnswer(existing)) {
      await showDashboard(person);
    } else {
      setTrip(tripToUse);
      setDestinationId(tripToUse.destinationId);
      setSavedAnswers(null);
      setScreen("preferences");
    }
  }

  useEffect(() => {
    async function start() {
      const savedProfile = await getProfile();
      if (savedProfile) {
        setProfile(savedProfile);
        await showDashboard(savedProfile);
      } else {
        setScreen("welcome");
      }
    }
    start();
  }, []);

  async function goHome() {
    if (profile) {
      await showDashboard(profile);
    } else {
      setTrip(null);
      setDestinationId(null);
      setScreen("welcome");
    }
  }

  function handleNewTrip() {
    setScreen("create");
  }

  function handleJoinTrip() {
    setScreen("join");
  }

  function handleLogin() {
    setScreen("login");
  }

  function handleSelectDestination(id) {
    setDestinationId(id);
  }

  async function handleCreateTrip({
    startDate,
    endDate,
    arrivalTime,
    departureTime,
    arrivalCity,
    departureCity,
  }) {
    const newTrip = await createTrip({
      destinationId,
      startDate,
      endDate,
      arrivalTime,
      departureTime,
      arrivalCity,
      departureCity,
    });
    setTrip(newTrip);
    setScreen("share");
  }

  function handleEditTrip() {
    if (!trip || !profile || getCreatorId(trip) !== profile.userId) return;
    setDestinationId(trip.destinationId);
    setScreen("editTrip");
  }

  function handleCancelEditTrip() {
    setDestinationId(trip.destinationId);
    setScreen("trip");
  }

  async function handleUpdateTrip({
    startDate,
    endDate,
    arrivalTime,
    departureTime,
    arrivalCity,
    departureCity,
  }) {
    const updated = await updateTrip(
      trip,
      {
        destinationId,
        startDate,
        endDate,
        arrivalTime,
        departureTime,
        arrivalCity,
        departureCity,
      },
      profile.userId
    );
    setTrip(updated);
    setDestinationId(updated.destinationId);
    setScreen("trip");
  }

  async function handleShareContinue() {
    if (profile) {
      const updatedTrip = await joinTrip(trip, profile);
      await goToPreferencesOrDashboard(profile, updatedTrip);
    } else {
      setScreen("signup");
    }
  }

  async function handleTripFound(foundTrip) {
    if (profile) {
      const updatedTrip = await joinTrip(foundTrip, profile);
      await goToPreferencesOrDashboard(profile, updatedTrip);
    } else {
      setTrip(foundTrip);
      setDestinationId(foundTrip.destinationId);
      setScreen("signup");
    }
  }

  async function handleSignedIn(signedInProfile) {
    await saveProfile(signedInProfile);
    setProfile(signedInProfile);
    if (trip) {
      const updatedTrip = await addMemberToTrip(trip, signedInProfile);
      await goToPreferencesOrDashboard(signedInProfile, updatedTrip);
    } else {
      await showDashboard(signedInProfile);
    }
  }

  async function handlePreferencesDone() {
    if (savedAnswers) {
      const saved = await getTravelProfile(profile.userId, trip.familyId);
      setHasTripPreferences(Boolean(saved && hasAnyAnswer(saved)));
      setSavedAnswers(null);
      setScreen("trip");
    } else {
      await showDashboard(profile);
    }
  }

  function handleCancelPreferences() {
    setSavedAnswers(null);
    setScreen("trip");
  }

  async function handleEditPreferences() {
    const saved = await getTravelProfile(profile.userId, trip.familyId);
    setSavedAnswers(answersFromTravelProfile(saved));
    setScreen("preferences");
  }

  async function handleOpenTrip(chosenTrip) {
    const saved = await getTravelProfile(profile.userId, chosenTrip.familyId);
    setHasTripPreferences(Boolean(saved && hasAnyAnswer(saved)));
    setTrip(chosenTrip);
    setDestinationId(chosenTrip.destinationId);
    setScreen("trip");
  }

  function handleOpenAccount() {
    setScreen("account");
  }

  async function handleSaveAccount(changes) {
    const updated = await updateProfile(profile.userId, changes);
    await refreshMemberInTrips(updated);
    setProfile(updated);
  }

  async function handleSignOut() {
    await clearProfile();
    setProfile(null);
    setTrips([]);
    setTrip(null);
    setDestinationId(null);
    setSavedAnswers(null);
    setScreen("welcome");
  }

  async function handleGeneratePlan() {
    const result = await generateGroupPlan(trip.familyId, profile.userId, trip);
    if (result.plan) {
      setPlan(result.plan);
      setScreen("plan");
    }
    return result;
  }

  async function handleDeleteTrip() {
    await deleteTrip(trip, profile.userId);
    await showDashboard(profile);
  }

  async function handleLeaveTrip() {
    await leaveTrip(trip, profile.userId);
    await showDashboard(profile);
  }

  const colors = {
    "--paper": theme.paper,
    "--ink": theme.ink,
    "--ink-soft": theme.inkSoft,
    "--sky": theme.sky,
    "--terracotta": theme.terracotta,
    "--gold": theme.gold,
    "--teal": theme.teal,
    "--pink": theme.pink,
    "--gold-soft": theme.goldSoft,
    "--teal-soft": theme.tealSoft,
    "--green-soft": theme.greenSoft,
  };

  return (
    <div className="app" style={colors}>
      {screen === "welcome" && (
        <WelcomeScreen
          onStartTrip={handleNewTrip}
          onJoinTrip={handleJoinTrip}
          onLogin={handleLogin}
        />
      )}

      {screen === "login" && (
        <SignUpScreen mode="login" onSave={handleSignedIn} onBack={goHome} />
      )}

      {screen === "create" && (
        <CreateTripScreen
          selectedId={destinationId}
          onSelect={handleSelectDestination}
          onCreate={handleCreateTrip}
          onBack={goHome}
        />
      )}

      {screen === "editTrip" && trip && profile && (
        <CreateTripScreen
          initialTrip={trip}
          selectedId={destinationId}
          onSelect={handleSelectDestination}
          onSave={handleUpdateTrip}
          onBack={handleCancelEditTrip}
        />
      )}

      {screen === "share" && trip && (
        <ShareCodeScreen trip={trip} onContinue={handleShareContinue} />
      )}

      {screen === "join" && (
        <JoinCodeScreen onFound={handleTripFound} onBack={goHome} />
      )}

      {screen === "signup" && (
        <SignUpScreen
          familyCode={trip ? trip.tripCode : null}
          onSave={handleSignedIn}
          onBack={goHome}
        />
      )}

      {screen === "preferences" && profile && trip && (
        <PreferencesScreen
          profile={profile}
          trip={trip}
          initialAnswers={savedAnswers}
          onDone={handlePreferencesDone}
          onCancel={savedAnswers ? handleCancelPreferences : null}
        />
      )}

      {screen === "dashboard" && profile && (
        <DashboardScreen
          profile={profile}
          trips={trips}
          onNewTrip={handleNewTrip}
          onJoinTrip={handleJoinTrip}
          onOpenTrip={handleOpenTrip}
          onOpenAccount={handleOpenAccount}
          onSignOut={handleSignOut}
        />
      )}

      {screen === "account" && profile && (
        <AccountScreen
          profile={profile}
          onSave={handleSaveAccount}
          onBack={() => showDashboard(profile)}
          onSignOut={handleSignOut}
        />
      )}

      {screen === "plan" && plan && trip && (
        <PlanScreen
          plan={plan}
          trip={trip}
          profile={profile}
          onPlanChange={setPlan}
          onRegenerate={handleGeneratePlan}
          onBack={() => setScreen("trip")}
        />
      )}

      {screen === "trip" && trip && profile && (
        <TripScreen
          trip={trip}
          profile={profile}
          hasPreferences={hasTripPreferences}
          onBack={() => showDashboard(profile)}
          onEditPreferences={handleEditPreferences}
          onEditTrip={handleEditTrip}
          onGeneratePlan={handleGeneratePlan}
          hasPlan={Boolean(plan)}
          onViewPlan={() => setScreen("plan")}
          onDeleteTrip={handleDeleteTrip}
          onLeaveTrip={handleLeaveTrip}
        />
      )}
    </div>
  );
}

export default App