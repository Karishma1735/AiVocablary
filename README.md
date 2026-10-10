# VocabRise AI

A practical business-English vocabulary coach for working professionals. VocabRise pairs a clear definition and Hindi meaning with natural examples for meetings, emails and everyday workplace conversations.

## What’s included

- Account registration, sign-in and logout with scrypt-hashed passwords and opaque HTTP-only session cookies.
- A daily word with pronunciation, part of speech, simple-English and Hindi meanings, synonyms and workplace examples.
- Bookmarking and marking words as learned, stored per user.
- Dashboard totals, recent words, study history and consecutive-day streaks calculated from persisted data.
- Profile settings and an opt-in preference for future daily email delivery.
- Optional Gemini generation through Google’s official <code>@google/genai</code> SDK. Generated words are cached by date. A curated starter library keeps the app useful when no key is configured or the provider is unavailable.
- A rate-limited, bearer-authenticated API prepared for a later viaSocket connection. No email is sent by this app.
- Responsive React UI styled with Tailwind CSS and a small custom design system.

## Requirements

- Node.js 20.19 or newer (or Node.js 22.12 or newer) and npm.
- SQLite, used through Prisma. No separate database server is needed for local development.
- A Gemini API key only if you want AI-generated words. The core app works without one.

## Run locally

1. Install packages: <code>npm install</code>
2. Copy <code>.env.example</code> to <code>.env</code>.
3. Set a long random <code>SESSION_SECRET</code>. One option is <code>openssl rand -hex 32</code>. Keep <code>.env</code> private.
4. Apply the checked-in Prisma migration and add starter vocabulary: <code>npm run db:setup</code>
5. Start the API and Vite client together: <code>npm run dev</code>
6. Open <code>http://localhost:5173</code> and create an account.

For production, run <code>npm run build</code>, set <code>NODE_ENV=production</code>, then run <code>npm start</code>. Express serves the Vite build from <code>dist</code>.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| <code>DATABASE_URL</code> | Yes | SQLite connection. Local default: <code>file:./dev.db</code> (resolved from the Prisma schema directory). |
| <code>SESSION_SECRET</code> | Recommended | Server-side secret used when hashing session tokens. If omitted, a random development-only secret is generated at startup. |
| <code>GEMINI_API_KEY</code> | No | Gemini API key, used only by the backend. Never put it in frontend variables or commit it. |
| <code>GEMINI_MODEL</code> | No | Model ID for vocabulary generation. Default: <code>gemini-3.8-flash</code>, listed as a stable text model in Google's model guide when this project was scaffolded. Change this if your account, region, or API-key permissions do not support it. |
| <code>INTEGRATION_API_KEY</code> | No | Long random bearer token for the future viaSocket endpoints. Leave empty to keep those endpoints disabled. |
| <code>PORT</code> | No | Express port. Defaults to <code>4000</code>. |
| <code>NODE_ENV</code> | No | Set to <code>production</code> for secure cookies and static serving. |

### Configure and verify Gemini

1. Create or select a key in Google AI Studio and add it to the server environment as <code>GEMINI_API_KEY</code>. The key is never returned by an API route or sent to React.
2. Set <code>GEMINI_MODEL</code> to an ID available to that key. The default is based on Google's current model list, not a promise of account access, region availability, quota, or price.
3. Sign in, open Settings and choose “Test Gemini connection.” This performs a small generation request with the configured model. It can consume API quota. A key/model failure is reported without exposing provider details to the browser.
4. If the test fails, check that the key is valid and enabled for the Gemini API, that the model ID is currently listed and available to the project, and that the account has quota. Google's model list: https://ai.google.dev/gemini-api/docs/models . SDK documentation: https://ai.google.dev/gemini-api/docs/libraries .

No Gemini key was included with the starter brief, so model access cannot be verified until you configure your own key. The Settings test is the runtime check.

## Database commands

- <code>npm run db:generate</code> generates the Prisma client.
- <code>npm run db:setup</code> applies checked-in migrations and seeds the starter vocabulary.
- <code>npm run db:migrate</code> creates/applies a development migration after a schema change.
- <code>npm run db:seed</code> is safe to rerun; words are upserted by their unique spelling.

SQLite is a good fit for a single-instance MVP. For a deployed app, store the database on a persistent disk and back it up. Do not run multiple app instances against a local SQLite file; use a production database supported by your chosen deployment if you need horizontal scaling.

## API overview

All browser endpoints are under <code>/api</code>. Private endpoints use the HTTP-only session cookie; user IDs are resolved from the session, never from a client-supplied owner ID. JSON errors use an <code>error</code> field.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | <code>/api/auth/register</code> | Create an account; body: <code>{"name":"Asha","email":"asha@example.com","password":"at-least-8"}</code>. |
| POST | <code>/api/auth/login</code> | Start a session; body: <code>{"email":"asha@example.com","password":"…"}</code>. |
| POST | <code>/api/auth/logout</code> | Revoke the current session and clear the cookie. |
| GET | <code>/api/auth/me</code> | Return the signed-in profile. |
| GET | <code>/api/dashboard</code> | Current daily word, learned/saved counts, streak and recent words. |
| GET | <code>/api/vocabulary/today</code> | Get or generate today’s cached word and the current user’s state. |
| GET | <code>/api/vocabulary/saved</code> | List the current user’s bookmarks. |
| PATCH | <code>/api/vocabulary/:wordId/bookmark</code> | Set bookmark state; body: <code>{"saved":true}</code>. |
| PATCH | <code>/api/vocabulary/:wordId/learn</code> | Mark a word learned; repeated calls do not count it twice. |
| GET | <code>/api/progress</code> | Learned total, streak, recent activity and recent words. |
| PATCH | <code>/api/profile</code> | Update name/email and email preference. |
| POST | <code>/api/settings/test-ai</code> | Verify the configured Gemini key/model with a small request. |
| GET | <code>/api/health</code> | Basic service status and non-secret AI configuration status. |

Authentication endpoints are rate-limited. Cookies are HTTP-only, SameSite=Lax and Secure in production. Passwords use Node’s scrypt; session tokens are random and only their hash is stored in SQLite.

## Future viaSocket API (not connected or sending email)

The integration endpoints are disabled until <code>INTEGRATION_API_KEY</code> is configured. Send it only from the server-side automation as <code>Authorization: Bearer YOUR_INTEGRATION_API_KEY</code>. Keep the token in viaSocket’s secret storage and Replit Secrets; never put it in a browser. All integration routes are rate-limited. An authenticated integration can only use the routes below, and the app does not send email itself.

### Read delivery preferences and address

<code>GET /api/integrations/v1/users/:userId</code>

Example response:

    {"id":"cm...","email":"asha@example.com","deliveryPreferences":{"enabled":true}}

### Fetch the next eligible word

<code>GET /api/integrations/v1/users/:userId/next-word</code>

The user must have enabled the daily-email preference in Settings. The response creates or reuses one pending delivery record for that user and date. Calling again returns the same record; after a successful delivery is recorded, another fetch for that date returns HTTP 409.

Example response:

    {"deliveryId":"cm...","date":"2026-10-10","recipient":"asha@example.com","word":{"id":"cm...","word":"align","pronunciation":"uh-LINE","partOfSpeech":"verb","meaning":"...","hindiMeaning":"...","synonyms":["coordinate","agree"],"examples":["..."]}}

### Record a delivery result

<code>POST /api/integrations/v1/deliveries/:deliveryId</code>

Body after success:

    {"status":"sent"}

Body after failure (error text is optional and limited to 300 characters):

    {"status":"failed","error":"Provider returned a temporary error"}

A unique database constraint on user and date prevents duplicate delivery records. Repeating a successful status update is idempotent and returns <code>{"ok":true,"status":"sent","duplicate":true}</code>. Failed records can be retried by recording a later outcome. The integration must send only after it has received the pending record, and should use the returned <code>deliveryId</code> as its idempotency key with its email provider.

## Project structure

- <code>client/src</code> — React screens and styles.
- <code>server</code> — Express API, session handling and Gemini service.
- <code>prisma/schema.prisma</code> — SQLite data model.
- <code>prisma/migrations</code> — versioned database migrations.
- <code>prisma/seed.js</code> — starter business-English words.

## Practice & Improve

A sidebar page that works as a simple AI conversation. The AI asks a freshly generated, random question (no predefined list; recent questions are sent back so it doesn't repeat). The learner answers by microphone or text, and the AI replies in the chat with the corrected version, an optional more natural version and the explained mistakes, then asks the next question. Corrections (grammar/spelling) are labelled separately from optional style changes, and the prompt forbids inventing facts or experience.

**Configuration:** set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in the server environment only. Run `npx prisma migrate deploy` (or `npm run db:setup`) to apply the `PracticeSession` migration. Without a key the page still loads and explains that the AI conversation isn't set up; the API replies `aiConfigured: false`.

**API (all require a signed-in session):** `GET /api/practice/config`, `POST /api/practice/question` and `POST /api/practice/check` (20/min limit, shared), `GET /api/practice/history`, `DELETE /api/practice/history/:id`, `DELETE /api/practice/history`. Gemini output is parsed and validated with Zod; bad output returns 502, rate limits 429.

**Microphone:** uses the browser Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), needs https or localhost, and the mic button only appears when the browser supports it. Recognition is done by the browser vendor's service (it may send audio to them); VocabRise never records or stores audio. Typing always works.

**History:** only saved when the "Save my practice" checkbox is on (default on, remembered in the browser). Entries are scoped to the signed-in user and can be deleted individually or all at once.

## Current MVP boundaries

- Daily email sending and viaSocket workflows are intentionally not implemented.
- Audio playback is not implemented; pronunciation is shown as a readable respelling.
- Gemini generation, model access and quota require your own server-side key. The starter word library is used as a fallback.
- Before a public launch, configure persistent database storage, set a strong production session secret, add backups and review the deployment’s operational/security needs.

## Daily vocabulary email (viaSocket)

The server decides *what* to send each day; a viaSocket flow does the scheduling, the Gmail send and the Google Sheet write.

Plan per user: 1 new word a day for 365 days (a word is never repeated), then 10 revision words a day until every learned word has been revised once (read from the store 200 rows at a time), then a new cycle of new words begins.

Set `INTEGRATION_API_KEY` on the server, then the flow calls (header `Authorization: Bearer <INTEGRATION_API_KEY>`):

- `GET /api/integrations/v1/recipients` — users who enabled daily email.
- `GET /api/integrations/v1/users/:userId/daily-email` — today's email: `subject`, `htmlBody`, `textBody`, `words[]`, and `sheetRows[]` (columns `Word`, `Hindi Meaning`, `English Meaning`, `Use Cases`; only for new words, empty on revision days). Calling it again the same day returns the same words.
- `POST /api/integrations/v1/deliveries/:deliveryId` with `{ "status": "sent" | "failed" }` — report the result.

Embarko deploy: `bash deploy/embarko/package.sh` builds the upload tarball.
