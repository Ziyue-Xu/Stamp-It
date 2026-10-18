# Stampit!

Stampit! helps a group plan a trip around one shared destination and dates,
while making room for each traveller's preferences. Create a trip, invite your
group, collect everyone's travel preferences, and build an editable,
AI-generated itinerary together.

The app is served at **`/travel`**. The root route redirects there. Its default
DeepSpace host is `swamphack.app.space`; `stamp-it.us` is the custom domain.

## What you can do

- **Create a trip:** choose a country, dates, arrival and departure times, and
  optional start and end cities. The app can suggest cities if those fields
  are left blank.
- **Invite travellers:** share the trip's four-digit code. Travellers sign in
  with their own verified email address before joining.
- **Set individual preferences:** answer questions about pace, budget, dietary
  requirements, ground transportation, activities, popularity of attractions,
  cuisine, mornings, shopping, travel style, tours, luggage, and pets.
- **Plan together:** the trip creator can generate or regenerate a group
  itinerary. Members can view it, edit or add stops, and request an alternative
  track for an activity that does not suit them. Each traveller can choose
  their preferred track.
- **Manage trips and profiles:** see trips on a dashboard, update a name or
  avatar, edit trip details as the organizer, leave a trip as a member, or
  delete it as the organizer.

The itinerary is organized by day and city, with timed activities, travel
between locations, lodging, meals, estimated costs, and notes explaining how
group preferences were balanced. Estimates are planning guidance, not booking
or availability guarantees.

## How the app works

### Sign-in and trip membership

Stampit! uses **Auth0 email passwordless sign-in**. Auth0 sends a
one-time code to the user's email address; the Worker redeems it and verifies
that the email is confirmed before creating a signed application session. The
session is a 30-day, `HttpOnly`, `SameSite=Lax` cookie. It is separate from
DeepSpace platform authentication.

Creating a trip makes its creator the organizer and provides a four-digit
family code. Joining requires both that code and a signed-in account. The
server checks membership for trip and itinerary access. Organizers can edit or
delete trip details and are the only people allowed to start full itinerary
generation. Other trip members can update their own preferences, view and edit
the saved itinerary, and leave; the organizer cannot leave their own trip.

### Preferences and AI itinerary

Preference answers are stored per traveller and per trip. Their priority
labels tell the planner how to combine them: critical preferences should be
respected, flexible preferences should be balanced across the group, and
weak-link preferences should include minority needs such as dietary
restrictions.

Itinerary generation runs on the Worker using **Gemini 3.8 Flash** with Google
Maps grounding and a structured itinerary schema. Generation runs as a
background interaction; the app polls with a signed, expiring token rather
than holding a request open. Requesting an alternative uses the same
server-side planner and updates the saved itinerary after validating that the
source activity has not changed. The Gemini API key is only used by the
Worker.

Trip dates, cities, member profiles, preferences, and saved itineraries are
stored in private, app-owned DeepSpace RecordRoom collections. Browser
permissions deny direct access to these travel collections; the Worker
performs reads and writes after session and family-membership checks.

**Data sent to the planner:** generating or splitting itinerary activities
sends trip details and relevant group or traveller preferences to Google's
Gemini service. Background interactions are stored by the integration for up
to seven days.

### Travel API

The browser calls the Worker on the same origin. The main route groups are:

| Route group | Operations |
| --- | --- |
| `/auth/*` | Start email sign-in, verify a one-time code, inspect the current session, and sign out |
| `/users/*` | Update the signed-in profile and list that user's trips |
| `/families/*` | Create, find, join, edit, leave, or delete trips; read or update a member's preferences |
| `/families/:familyId/plan/*` | Read and save itineraries, start and poll plan generation, and request and poll activity alternatives |

The Worker also registers `/travel/families/*` aliases for itinerary operations.
These routes are session- and membership-protected; write operations additionally
require a same-origin request.

## Application structure

This repository combines the Stampit! experience with a DeepSpace app runtime:

- [`worker.ts`](./worker.ts) assembles the Cloudflare Worker, Durable Objects,
  API and WebSocket routes, static assets, and the owner-only local-agent tool
  routes.
- [`src/server/travel-routes.ts`](./src/server/travel-routes.ts) implements
  Stampit!'s Auth0 session flow, profiles, trips, memberships,
  preferences, itinerary storage, and planner polling.
- [`src/server/trip-planner.ts`](./src/server/trip-planner.ts) calls Gemini
  with Google Maps grounding and validates the planner interaction response.
- [`src/schemas/travel-schema.ts`](./src/schemas/travel-schema.ts) defines the
  private `travel-users`, `travel-families`, and `travel-plans` collections.
- [`src/travel-app.jsx`](./src/travel-app.jsx) is the Stampit! app
  controller. It composes the UI screens and visual assets in
  [`my-travel-app/src/`](./my-travel-app/src/). The root app imports these
  screens and selected data/API helpers; the nested `my-travel-app/src/App.jsx`
  is not the deployed entry point.
- [`src/travel-main.jsx`](./src/travel-main.jsx) mounts the travel UI, and
  [`travel.html`](./travel.html) provides its HTML entry point.
- [`src/pages/`](./src/pages/) contains the separate generated DeepSpace
  application shell, including `/home`, `/settings`, and
  `/family-preferences`. These scaffold routes use DeepSpace platform auth;
  they are distinct from the Auth0-backed Stampit! experience. The
  `/home` page is still a scaffold placeholder.
- [`AIPipeline/`](./AIPipeline/) and [`AccCreationBackend/`](./AccCreationBackend/)
  contain earlier Python experiments and templates. The deployed travel
  experience uses the TypeScript Worker and does not require the local Flask
  account-creation server.

The Worker also wires DeepSpace RecordRoom, Yjs, Canvas, Presence, Cron, and
Job Durable Objects. Cron tasks and job handlers are extension points and are
currently empty/no-op. DeepSpace local-agent tools are registered for the app
owner; the in-app assistant is disabled.

## Development

### Requirements

- Node.js `>=22.15 <23`, `>=24 <25`, or `>=26 <27`
- npm `>=11.6`
- A DeepSpace account for local development and deployment
- Auth0 passwordless email configuration and Gemini API access for the full
  travel experience

Install dependencies and start the app:

```sh
npm ci
npm run login
npm run dev
```

The DeepSpace dev command starts the Vite/Worker development environment.
Open the local URL it prints and navigate to `/travel`.

### Configure runtime secrets

Enable the Auth0 **Email passwordless** connection for the Native application
whose client ID the app uses. Configure these values in the DeepSpace encrypted
secrets store; never commit them or put them in frontend environment variables
or `.dev.vars`:

| Secret | Purpose |
| --- | --- |
| `AUTH0_DOMAIN` | Auth0 tenant hostname |
| `AUTH0_CLIENT_ID` | Passwordless Native application client ID |
| `AUTH0_SESSION_SECRET` | Random session-signing secret, at least 32 characters |
| `GEMINI_API_KEY` | Server-side access to Gemini itinerary generation |

Set secrets through the CLI's standard-input mode, entering each value only
when prompted:

```sh
npx deepspace secrets set AUTH0_DOMAIN --stdin
npx deepspace secrets set AUTH0_CLIENT_ID --stdin
npx deepspace secrets set AUTH0_SESSION_SECRET --stdin
npx deepspace secrets set GEMINI_API_KEY --stdin
```

Without the Auth0 settings, users cannot sign in. Without `GEMINI_API_KEY`,
itinerary generation and activity-split suggestions are unavailable.

## Common commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start DeepSpace local development |
| `npm run build` | Build the client and Worker with Vite |
| `npm run type-check` | Run the TypeScript compiler without emitting files |
| `npm run lint` | Lint the repository with ESLint |
| `npm run test` | Run the quick DeepSpace test selection |
| `npm run test:smoke` | Run the DeepSpace smoke tests |
| `npm run test:api` | Run the DeepSpace API tests |
| `npm run test:e2e` | Run the DeepSpace end-to-end tests |
| `npm run test:unit` | Run unit tests with Vitest |
| `npm run validate` | Run type-checking and unit tests |
| `npm run deploy` | Deploy the app with the DeepSpace CLI |

The multi-user collaboration tests need at least two usable DeepSpace test
accounts. They skip when that local test-account pool is not available.

## Testing notes

The repository has unit tests for travel preference normalization, itinerary
split editing, server route behavior, and prerendering, plus Playwright smoke,
API, and collaboration specifications. A quick first check is:

```sh
npm run validate
npm run test:smoke
```

Use `npm run test:e2e` or `npx deepspace test run all` when validating the full
DeepSpace test suite. Multi-user behavior should be checked with two distinct
test accounts.

## Deployment

Confirm the intended DeepSpace account is logged in, configure the required
encrypted secrets, then deploy:

```sh
npm run login
npx deepspace auth whoami --json
npm run deploy
```

The app is hosted by DeepSpace on Cloudflare Workers. The public travel
experience is available at `/travel`; the Worker handles API requests and
serves the built client assets.
