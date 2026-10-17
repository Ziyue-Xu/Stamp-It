# Hosted travel app

The travel UI is available at `/travel` on the DeepSpace app. Its Vite entry
imports the existing `my-travel-app` screens and API modules without changing
that project. Its API calls are redirected at build time to same-origin
DeepSpace Worker routes. The local account-creation Flask server is not used
by the production travel app.

Members sign in with Auth0's email passwordless OTP connection. The Worker
redeems the code with Auth0, requires a verified matching email, and issues a
30-day HttpOnly, SameSite session cookie signed with `AUTH0_SESSION_SECRET`.
This is a separate travel-app session, not a DeepSpace platform-auth session.
It does not grant access to the DeepSpace records/realtime APIs.

The Worker stores user, family, and generated plan data in private, app-owned
`travel-users`, `travel-families`, and `travel-plans` collections backed by DeepSpace RecordRoom.
The private collections are accessed only by the Worker after Auth0 session
and family-membership checks; browser record permissions deny direct access.
This uses the app's existing Durable Object binding and requires no custom
Cloudflare binding, so it is compatible with the free DeepSpace tier.

Completed itinerary JSON is stored separately in `travel-plans`, keyed by
`familyCode`, so family records continue to match the AIPipeline template.
After generation, any signed-in member of that family can request
`GET /families/{familyCode}/plan` (or the `/travel/families/...` alias) to
retrieve the saved itinerary. Non-members are denied; a family with no
generated plan receives 404. The travel UI requests the stored plan before
starting generation, while plan creation remains limited to the trip creator.

Each stored `travel-families` record follows the AIPipeline family template:
`familyCode`, `country`, separate ISO `startDate`/`endDate` and 24-hour
`startTime`/`endTime`, `startCity`, `endCity`, and `users`. Member profiles
store only `userId`, `name`, and `email`; travel preferences use the template's
`activityPopularity` key. The Worker adapts the existing travel UI's request
and response format at the API boundary, and normalizes older family records
when it reads them. The first user in `users` is the trip creator.
Arrival and departure cities are optional when creating a trip. If either is
left blank, the itinerary planner chooses a suitable city within the selected
country.

Trip detail edits are saved to the family record and clear the existing
itinerary so it can be regenerated with the updated trip details. Organizers
can delete trips, which removes the family and saved-itinerary records and
clears each member's trip reference. Other members can leave; leaving removes
that member and their preferences from the family JSON and clears their trip
reference. The organizer cannot leave their own trip.

Trip members can view the saved itinerary. Changes made to itinerary stops
are saved to the private `travel-plans` collection, and organizers can
regenerate the itinerary to replace edits with a fresh plan.

## Configure the AI trip planner

Plan generation runs entirely in the DeepSpace Worker. It loads family
preferences from the private DeepSpace record, verifies the signed-in user is
the trip creator, and starts a background Gemini Interaction with Google Maps
grounding and a structured itinerary schema. The DeepSpace travel wrapper polls
the Worker until the itinerary is ready; a signed, expiring token binds polling
to that creator and family. This avoids holding one HTTP request open during
long generations. Background interactions require server-side storage for
polling; this integration opts into Gemini's seven-day interaction retention.
The API key is read only by the Worker and is never sent to the browser.

Set the API key in the DeepSpace encrypted secrets store, then deploy to apply
it to the Worker:

```powershell
$geminiKey = Read-Host "Gemini API key" -AsSecureString
[System.Net.NetworkCredential]::new("", $geminiKey).Password | npx.cmd deepspace secrets set GEMINI_API_KEY --stdin
Remove-Variable geminiKey
npx.cmd deepspace deploy
```

The key is entered securely in PowerShell and piped to the CLI without placing
it in command history or a command-line argument. Do not put the key in source
files, frontend environment variables, or `.dev.vars`. Plan generation returns
503 until `GEMINI_API_KEY` is configured.

## Configure Auth0

In the Auth0 tenant used by `AccCreationBackend`, enable the Email passwordless
connection for the same application/client ID. Configure these values in the
DeepSpace secrets store; do not put them in source files or `.dev.vars`:

- `AUTH0_DOMAIN`: tenant hostname (for example, `tenant.us.auth0.com`)
- `AUTH0_CLIENT_ID`: the passwordless application's client ID
- `AUTH0_SESSION_SECRET`: a random secret with at least 32 characters

The current app is registered to a GitHub source, and deploy ships the local
worktree. The Auth0 secrets store must contain all three values before the app
can sign in users. After checking `npx.cmd deepspace auth whoami --json` is the
intended account, set the domain and client ID using the matching Auth0
passwordless application's values:

```powershell
npx.cmd deepspace secrets set AUTH0_DOMAIN --stdin
npx.cmd deepspace secrets set AUTH0_CLIENT_ID --stdin
```

For each command, enter that value on standard input, then press Ctrl+Z and
Enter to finish. The travel app uses an Auth0 Native application and does not
send or need an Auth0 client secret. Generate and store the signing secret
without putting its value in command history:

```powershell
$sessionSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$sessionSecret | npx.cmd deepspace secrets set AUTH0_SESSION_SECRET --stdin
Remove-Variable sessionSecret
```

The email OTP exchange is server-to-server, so the browser does not need Auth0
callback URLs or client secrets.

## Build and deploy

```powershell
npx.cmd deepspace auth whoami --json
npx.cmd deepspace secrets list --json
npx.cmd deepspace deploy
```

The `secrets list` result should show `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`,
`AUTH0_SESSION_SECRET`, and `GEMINI_API_KEY` before deploying. Open `/travel`
on the deployed app. Deployment requires an authenticated DeepSpace CLI
account with deploy access.
