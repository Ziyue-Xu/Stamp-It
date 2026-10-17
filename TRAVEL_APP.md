# Hosted travel app

The travel UI is available at `/travel` on the DeepSpace app. Its Vite entry
imports the existing `my-travel-app` screens and API modules without changing
that project. Its API calls are redirected at build time to same-origin
DeepSpace Worker routes; the local Flask server is not needed in production.

Members sign in with Auth0's email passwordless OTP connection. The Worker
redeems the code with Auth0, requires a verified matching email, and issues a
30-day HttpOnly, SameSite session cookie signed with `AUTH0_SESSION_SECRET`.
This is a separate travel-app session, not a DeepSpace platform-auth session.
It does not grant access to the DeepSpace records/realtime APIs.

The Worker stores user and family data in private, app-owned
`travel-users` and `travel-families` collections backed by DeepSpace RecordRoom.
The private collections are accessed only by the Worker after Auth0 session
and family-membership checks; browser record permissions deny direct access.
This uses the app's existing Durable Object binding and requires no custom
Cloudflare binding, so it is compatible with the free DeepSpace tier.

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

The `secrets list` result should show all three names before deploying.
Deployment builds and tests already pass locally. Open `/travel` on the
deployed app. Deployment requires an authenticated DeepSpace CLI account with
deploy access.
