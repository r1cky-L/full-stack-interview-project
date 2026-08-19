# Secure Support Desk

A small support-ticket application. Customers raise tickets and see only their
own; support agents see every ticket, filter by status, and move tickets
between `open`, `in_progress` and `resolved`.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS ·
Supabase Auth · Supabase Postgres

---

## Setup

Requires Node.js 20+ and a free Supabase project.

### 1. Install

```bash
npm install
```

### 2. Create the database

Open your Supabase project, go to **SQL Editor**, paste the entire contents of
[`supabase/schema.sql`](supabase/schema.sql) and run it.

That single file is the whole database setup: enums, tables, indexes, the
signup trigger, table grants and every row level security policy. It is
idempotent, so re-running it is safe.

The last statement prints a self-check. Both rows must say `true`:

| table_name | rls_enabled |
| ---------- | ----------- |
| profiles   | true        |
| tickets    | true        |

### 3. Turn off email confirmation

**Authentication → Sign In / Providers → Email → disable "Confirm email" → Save.**

Without this, signing up parks the account in an unconfirmed state and Supabase
tries to send mail through its shared SMTP, which is rate-limited to a couple
of messages per hour. Turning it off lets you create test accounts freely.

### 4. Configure the app

```bash
cp .env.example .env.local
```

Fill in both values from **Project Settings → API Keys**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

There is no `service_role` key here, by design — see
[Security model](#security-model).

### 5. Run

```bash
npm run dev
```

http://localhost:3000

---

## Testing both roles

### Customer

1. Go to http://localhost:3000 — you are redirected to `/login`.
2. **Sign up** with any email and password (min. 6 characters). New accounts are
   always customers.
3. **New ticket** → fill in a title and description → **Create ticket**.
4. The list shows your tickets and nothing else.

Sign up a **second** customer and confirm they cannot see the first one's
tickets.

### Support agent

Roles are not self-service. Sign an account up through the app first, then
promote it in the Supabase **SQL Editor**:

```sql
update public.profiles set role = 'agent' where email = 'agent@yourdomain.com';
```

Sign out, sign back in as that account, and you get:

- every ticket, with the owning customer's email
- a **Status** filter
- a status dropdown on the ticket detail page

The SQL Editor connects as `postgres`, which is exactly why it can write this
table while the application never can.

---

## Security model

The brief's requirement is that a customer must never read or modify another
customer's tickets, give themselves a different role, or perform agent actions.
Two independent layers enforce that, and either one alone would be sufficient.

### Layer 1 — the API

Every route handler calls `getAuthContext()` ([`src/lib/auth.ts`](src/lib/auth.ts)),
which validates the caller's token with `getUser()` (a round trip to the auth
server) rather than `getSession()` (which merely decodes a client-controlled
cookie), then reads their role from `public.profiles`.

Request bodies are parsed with zod and only the parsed fields are written. On
create, `customer_id` comes from the session and `status` is left to the
database default, so neither can be smuggled in through the request body.

### Layer 2 — Postgres

The app talks to Postgres with the **anon key plus the caller's own token**, so
every query runs as that user and RLS applies. Two mechanisms are stacked:

**Table and column grants.** `authenticated` may `select` tickets, `insert`
only `(customer_id, title, description)`, and `update` only `(status)`. There
is no `delete` grant, and no `insert`/`update`/`delete` on `profiles` at all.
`anon` has no privileges whatsoever.

**Row level security.** Customers match `customer_id = auth.uid()`; agents match
a `SECURITY DEFINER` `is_agent()` helper. Insert and update policies carry a
`WITH CHECK` clause, not just `USING`, so a customer cannot create a ticket
owned by someone else or pre-set one to `resolved`.

### Why the role lives in `public.profiles`

`auth.users.raw_user_meta_data` is writable by the user themselves through
`supabase.auth.updateUser({ data: { role: 'agent' } })`. A role stored there
could be forged by any customer in one line of JavaScript.

Instead the role sits in `public.profiles`, which has **no insert, update or
delete grant and no policy for those commands** — so nobody can write it
through the API, including the row's own owner. Rows are created solely by the
`handle_new_user()` trigger, which hard-codes `'customer'` and never reads the
signup payload.

### Why there is no `service_role` key

A `service_role` key bypasses RLS entirely; anywhere it is used, the database
stops being a safety net and the application code becomes the only thing
standing between a customer and everyone else's data. This app never needs it:
the only privileged operation is promoting an agent, which is a one-line SQL
statement run by an administrator.

The consequence worth stating plainly: deleting every authorisation check in
`src/app/api` would not leak a single row.

---

## Automated security checks

```bash
npm run dev          # in one terminal
npm run security-check
```

[`scripts/security-check.mjs`](scripts/security-check.mjs) signs up two throwaway
customers, then attempts each attack from the brief — twice. Once through this
app's API, and once straight against Supabase's PostgREST endpoint using the
public anon key, which is what an attacker would actually do after reading the
JavaScript bundle.

It covers unauthenticated access, cross-customer reads through both surfaces,
customers attempting agent actions, `profiles.role` updates, the
`user_metadata` escalation trick, mass assignment on create, title rewrites
blocked by column grants, deletion, and the agent's own happy path.

It needs an agent account. Add its credentials to `.env.local`:

```
TEST_AGENT_EMAIL=agent@yourdomain.com
TEST_AGENT_PASSWORD=...
```

## End-to-end tests

```bash
npx playwright install chromium   # once
npm run e2e
```

[`e2e/roles.spec.ts`](e2e/roles.spec.ts) drives the real UI through both role
journeys: a customer signing up, raising a ticket and reading it back; a second
customer finding neither the ticket in their list nor at its direct URL; an
agent seeing every ticket with the owning customer's email, filtering by
status, and moving a ticket to `in_progress`; and the customer then seeing that
new status without being offered the control that produced it.

The suite reuses a dev server if one is already running, and starts one
otherwise. It uses the same `TEST_AGENT_*` credentials as the security check.

---

## API

All routes accept either the browser session cookie or an
`Authorization: Bearer <access_token>` header, so they can be exercised with
curl.

| Method  | Route              | Who         | Notes                                    |
| ------- | ------------------ | ----------- | ---------------------------------------- |
| `GET`   | `/api/tickets`     | any user    | `?status=` filter; customers see own only |
| `POST`  | `/api/tickets`     | any user    | `{ title, description }`                  |
| `GET`   | `/api/tickets/:id` | any user    | 404 if not yours and you are not an agent |
| `PATCH` | `/api/tickets/:id` | agents only | `{ status }`                             |

Reading someone else's ticket returns **404, not 403**, so the response does not
confirm that the ticket exists.

---

## Architecture

```
Browser (React)
  │  session cookie, or Authorization: Bearer <token>
  ▼
Next.js Route Handlers  ── validate token · look up role · zod-validate input
  │  anon key + the caller's own JWT
  ▼
Supabase Postgres  ── column grants · row level security
```

```
src/
  proxy.ts                  session refresh + redirect for signed-out visitors
  app/
    login/                  sign in / sign up
    tickets/                list, detail, create  (server-rendered auth guard,
                            client components for data)
    api/tickets/            REST route handlers
  lib/
    auth.ts                 getAuthContext(): identity + role for a request
    supabase/               browser · server (cookies) · bearer (curl) clients
    validation.ts           zod schemas
supabase/schema.sql         the entire database
scripts/security-check.mjs  the attack matrix above
e2e/roles.spec.ts           both role journeys through the real UI
```

Pages are Server Components that resolve the session and hand the role to a
Client Component, which then fetches through the REST API. The server-side guard
means no flash of unauthenticated content; the client-side fetch means the API
is genuinely exercised by the UI rather than bypassed by direct database reads.

`proxy.ts` (Next.js 16's rename of `middleware.ts`) refreshes the Supabase
session and bounces signed-out visitors to `/login`. It deliberately skips
`/api/*`, so an unauthenticated API call gets a clean 401 instead of an HTML
redirect. It is a convenience layer, not a security boundary — every route
handler re-checks the caller regardless.

---

## Trade-offs and what I left out

Built to the brief's 2–3 hour timebox. Deliberate omissions:

- **No unit tests.** Testing effort went to the two suites that cover the
  brief's actual risk — authorisation (`npm run security-check`) and the two
  role journeys (`npm run e2e`). A longer-lived codebase would want Vitest
  around `validation.ts` and the route handlers so failures point at a function
  rather than at a screen.
- **No pagination.** The ticket list fetches everything. Fine for a demo,
  wrong past a few hundred rows — it wants keyset pagination on
  `(created_at, id)`, which the existing indexes already support.
- **No ticket comments or assignment.** Not in the brief.
- **No optimistic UI or realtime.** Status changes round-trip to the server;
  Supabase Realtime would be the natural next step for an agent watching a
  queue.
- **Agents can also open tickets.** The brief lists ticket creation under
  customers, but an agent creating a ticket for themselves is not a privilege
  escalation in either direction, so `POST /api/tickets` allows any
  authenticated user and simply files it under their own account. The
  **New ticket** button is only rendered for customers.
- **No audit trail.** Status transitions overwrite `status` and bump
  `updated_at`. A support product would want a `ticket_events` table recording
  who changed what and when.
- **Error handling is minimal** — one message per form. No retry, no toasts.
- **Styling is deliberately plain**, per "visual design is not the focus".
