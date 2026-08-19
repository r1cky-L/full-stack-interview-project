# Notes

The short version. [README.md](README.md) has the setup steps and the full
reasoning.

## Architecture

Next.js 16 (App Router) · React 19 · TypeScript · Supabase Auth · Supabase
Postgres. No separate API server: the brief asked for Next.js, and its Route
Handlers already are the backend.

```
Browser (React)
  │  session cookie, or Authorization: Bearer <token>
  ▼
Next.js Route Handlers  ── validate token · look up role · zod-validate input
  │  anon key + the caller's own JWT
  ▼
Supabase Postgres  ── column grants · row level security
```

Pages are Server Components that resolve the session and pass the role to a
Client Component, which then fetches through the REST API. The server-side
guard avoids a flash of unauthenticated content; the client-side fetch means
the API is genuinely exercised by the UI rather than bypassed.

**Two independent layers enforce access, and either alone would be enough.**

1. **The API.** Every route validates the token with `getUser()` — a round trip
   to the auth server — rather than `getSession()`, which only decodes a
   client-controlled cookie. Bodies go through zod and only parsed fields are
   written, so `customer_id` and `status` cannot be smuggled in on create.

2. **Postgres.** Queries run with the anon key plus the caller's own token, so
   RLS applies to all of them. Column grants let `authenticated` insert only
   `(customer_id, title, description)` and update only `(status)`; `anon` has
   no privileges at all.

Three decisions worth calling out:

- **The role lives in `public.profiles`, not in user metadata.**
  `auth.users.raw_user_meta_data` is writable by the user themselves via
  `supabase.auth.updateUser({ data: { role: 'agent' } })`. `public.profiles` has
  no insert/update grant and no insert/update policy, so nobody can write it
  through the API — including the row's own owner. Rows are created only by a
  `SECURITY DEFINER` signup trigger that hard-codes `'customer'`.

- **There is no `service_role` key in the project.** It bypasses RLS, so
  wherever it is used the application code becomes the only thing between a
  customer and everyone else's data. The one privileged operation — promoting an
  agent — is a single SQL statement run by an administrator. Concretely: deleting
  every authorisation check in `src/app/api` would still not leak a row.

- **Reading someone else's ticket returns 404, not 403**, so the response does
  not confirm that the ticket exists.

## Trade-offs and unfinished items

Built to the 2–3 hour timebox.

- **No unit tests.** Effort went to the two suites covering the actual risk:
  `npm run security-check` (28 authorisation probes) and `npm run e2e` (both
  role journeys). Vitest around `validation.ts` and the route handlers would be
  next, so failures point at a function rather than a screen.
- **No pagination.** The list fetches everything. Wrong past a few hundred rows;
  it wants keyset pagination on `(created_at, id)`, which the indexes support.
- **No audit trail.** Status changes overwrite `status`. A real support product
  needs a `ticket_events` table recording who changed what, when.
- **No comments, assignment, or realtime.** Not in the brief. Supabase Realtime
  is the natural next step for an agent watching a queue.
- **Agents can also open tickets.** Creation is allowed for any authenticated
  user and always filed under their own account — not an escalation in either
  direction. The **New ticket** button is only rendered for customers.
- **Minimal error handling**, one message per form. No retries, no toasts.
- **Styling is deliberately plain**, per "visual design is not the focus".

## How to test both roles

After the setup in [README.md](README.md) — run `supabase/schema.sql`, turn off
"Confirm email", fill in `.env.local`, `npm run dev`.

**Customer.** Sign up at http://localhost:3000 with any email. New accounts are
always customers. Create a ticket; the list shows yours and nothing else. Sign
up a second customer and confirm the first one's ticket is invisible — including
at its direct `/tickets/<id>` URL.

**Support agent.** Roles are not self-service. Sign an account up through the
app, then promote it in the Supabase SQL Editor:

```sql
update public.profiles set role = 'agent' where email = 'agent@yourdomain.com';
```

Sign back in and you get every ticket with the owning customer's email, a status
filter, and a status dropdown on the detail page.

**Or run the suites.** `npm run security-check` walks the attack matrix twice —
once through this app's API, once straight at Supabase's PostgREST endpoint with
the public anon key, which is what an attacker would do after reading the
JavaScript bundle. `npm run e2e` drives both journeys through the real UI.
