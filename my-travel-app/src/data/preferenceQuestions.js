

export const PREFERENCE_QUESTIONS = [
  {
    field: "tripPace",
    type: "scale",
    priority: "flexible",
    title: "What pace feels right?",
    subtitle: "Slow mornings, or packed days?",
    low: "Slow",
    high: "Fast",
  },
  {
    field: "budgetTier",
    type: "budget",
    priority: "critical",
    title: "What's your budget?",
    subtitle: "Think hotels, meals and activities.",
    options: [
      { value: 1, label: "$", note: "Budget-friendly" },
      { value: 2, label: "$$", note: "Comfortable" },
      { value: 3, label: "$$$", note: "Treat yourself" },
    ],
  },
  {
    field: "dietaryRestrictions",
    type: "multi",
    priority: "weak_link",
    title: "Any dietary needs?",
    subtitle: "Pick all that apply.",
    options: [
      { value: "none", label: "None" },
      { value: "vegan", label: "Vegan" },
      { value: "vegetarian", label: "Vegetarian" },
      { value: "gluten-free", label: "Gluten-free" },
      { value: "halal", label: "Halal" },
      { value: "kosher", label: "Kosher" },
      { value: "pescatarian", label: "Pescatarian" },
      { value: "dairy-free", label: "Dairy-free" },
    ],
  },
  {
    field: "groundTransportation",
    type: "single",
    priority: "critical",
    title: "How do you like to get around?",
    subtitle: "On the ground, once you've arrived.",
    options: [
      { value: "rental", label: "Rental car" },
      { value: "rideshare", label: "Rideshare" },
      { value: "public", label: "Public transport" },
    ],
  },
  {
    field: "activityFocus",
    type: "multi",
    priority: "flexible",
    title: "What activities are you most interested in?",
    subtitle: "Pick all that apply.",
    options: [
      { value: "culture", label: "Culture" },
      { value: "nature", label: "Nature" },
      { value: "city_life", label: "City life" },
      { value: "historical", label: "History" },
    ],
  },
  {
    field: "attractionPopularity",
    type: "scale",
    priority: "flexible",
    title: "Hidden gems or hotspots?",
    subtitle: "Quiet local finds, or the famous must-sees?",
    low: "Hidden gems",
    high: "Hotspots",
  },
  {
    field: "diningCuisine",
    type: "single",
    priority: "flexible",
    title: "What's on your plate?",
    subtitle: "Your usual style of eating out.",
    options: [
      { value: "local", label: "Local favorites" },
      { value: "casual", label: "Casual and easy" },
    ],
  },
  {
    field: "morningRoutine",
    type: "single",
    priority: "flexible",
    title: "When do your mornings start?",
    subtitle: "Be honest. Vacation counts.",
    options: [
      { value: "early", label: "Early bird", note: "6 to 8 AM" },
      { value: "midway", label: "Midway", note: "8 to 10 AM" },
      { value: "late", label: "Night owl", note: "10 AM to noon" },
    ],
  },
  {
    field: "interestedInShopping",
    type: "boolean",
    priority: "flexible",
    title: "Interested in shopping?",
    subtitle: "Markets, boutiques and souvenirs.",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  },
  {
    field: "travelStyle",
    type: "scale",
    priority: "flexible",
    title: "Relaxed or explorative?",
    subtitle: "Where do you land on a trip?",
    low: "Relaxed",
    high: "Explorative",
  },
  {
    field: "tourPreference",
    type: "single",
    priority: "flexible",
    title: "How do you like to explore?",
    subtitle: "Pick one.",
    options: [
      { value: "self-guided", label: "Self-guided" },
      { value: "guided", label: "Guided tours" },
    ],
  },
  {
    field: "luggagePreference",
    type: "single",
    priority: "critical",
    title: "What are you packing?",
    subtitle: "Pick the one that fits you.",
    options: [
      { value: "backpacking", label: "A backpack" },
      { value: "suitcases", label: "Suitcases" },
    ],
  },
  {
    field: "petFriendly",
    type: "boolean",
    priority: "weak_link",
    title: "Do you need pet-friendly places?",
    subtitle: "For example, if a pet is coming along.",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  },
];


export const PRIORITY_HINTS = {
  critical: "Your group will agree on this one.",
  weak_link: "We'll make sure everyone's needs are covered.",
  flexible: "We'll blend everyone's answers.",
};


export function emptyAnswers() {
  const answers = {};
  for (const question of PREFERENCE_QUESTIONS) {
    answers[question.field] = question.type === "multi" ? [] : null;
  }
  return answers;
}


export function buildTravelProfile(answers) {
  const travelProfile = {};
  for (const question of PREFERENCE_QUESTIONS) {
    travelProfile[question.field] = {
      value: answers[question.field],
      priority: question.priority,
    };
  }
  return travelProfile;
}


export function hasAnyAnswer(travelProfile) {
  return Object.values(travelProfile).some((entry) =>
    Array.isArray(entry.value) ? entry.value.length > 0 : entry.value !== null
  );
}

export function answersFromTravelProfile(travelProfile) {
  const answers = emptyAnswers();
  for (const question of PREFERENCE_QUESTIONS) {
    const entry = travelProfile && travelProfile[question.field];
    if (entry && entry.value !== undefined && entry.value !== null) {

      const saved = entry.value;
      answers[question.field] =
        question.type === "multi" && !Array.isArray(saved) ? [saved] : saved;
    }
  }
  return answers;
}