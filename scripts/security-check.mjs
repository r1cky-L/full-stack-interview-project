/**
 * Security boundary tests for Secure Support Desk.
 *
 * Every check below is an attempt to break one of the rules in the brief:
 * customers must not read or modify another customer's tickets, must not give
 * themselves a different role, and must not perform support-agent actions.
 *
 * Each rule is probed twice -- once through the app's own API, and once
 * straight at Supabase's PostgREST endpoint with the public anon key, which is
 * what an attacker would actually do after reading the JavaScript bundle.
 *
 *   node scripts/security-check.mjs
 *
 * Prerequisites (see README):
 *   1. supabase/schema.sql has been run
 *   2. `npm run dev` is running on http://localhost:3000
 *   3. Email confirmation is switched off in the Supabase dashboard
 *   4. An agent account exists, promoted via SQL, and its credentials are in
 *      .env.local as TEST_AGENT_EMAIL / TEST_AGENT_PASSWORD
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------- env ------

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const AGENT_EMAIL = env.TEST_AGENT_EMAIL;
const AGENT_PASSWORD = env.TEST_AGENT_PASSWORD;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing Supabase settings in .env.local');
  process.exit(1);
}
if (!AGENT_EMAIL || !AGENT_PASSWORD) {
  console.error(
    'Missing TEST_AGENT_EMAIL / TEST_AGENT_PASSWORD in .env.local.\n' +
      'Sign an account up in the app, promote it with:\n' +
      "  update public.profiles set role = 'agent' where email = '<that email>';\n" +
      'then add the credentials to .env.local.',
  );
  process.exit(1);
}

// -------------------------------------------------------------- harness ----

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Calls the app's own API with a bearer token. */
async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${APP}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Calls Supabase PostgREST directly, bypassing the app entirely. */
async function rest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function signUpCustomer(label) {
  // Not @example.com: Supabase rejects reserved domains at sign-up.
  const email = `test-${label}-${randomUUID().slice(0, 8)}@supportdesk.dev`;
  const password = `Pw-${randomUUID()}`;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(`Sign-up failed for ${label}: ${error.message}`);
  if (!data.session) {
    throw new Error(
      `Sign-up for ${label} returned no session. Turn off "Confirm email" in ` +
        'Supabase -> Authentication -> Sign In / Providers -> Email.',
    );
  }
  return { email, password, id: data.user.id, token: data.session.access_token, client };
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { id: data.user.id, token: data.session.access_token, client };
}

// ----------------------------------------------------------------- run -----

console.log(`Secure Support Desk -- security boundary checks\napp: ${APP}\n`);

const alice = await signUpCustomer('alice');
const bob = await signUpCustomer('bob');
const agent = await signIn(AGENT_EMAIL, AGENT_PASSWORD);

const agentProfile = await rest(`/profiles?id=eq.${agent.id}&select=role`, { token: agent.token });
if (agentProfile.body?.[0]?.role !== 'agent') {
  console.error(
    `\n${AGENT_EMAIL} has role "${agentProfile.body?.[0]?.role ?? 'unknown'}", not "agent".\n` +
      `Run: update public.profiles set role = 'agent' where email = '${AGENT_EMAIL}';`,
  );
  process.exit(1);
}

// Seed one ticket per customer.
const aliceTicket = (
  await api('/api/tickets', {
    token: alice.token,
    method: 'POST',
    body: { title: "Alice's private ticket", description: 'Confidential text.' },
  })
).body?.ticket;
const bobTicket = (
  await api('/api/tickets', {
    token: bob.token,
    method: 'POST',
    body: { title: "Bob's private ticket", description: 'Also confidential.' },
  })
).body?.ticket;

if (!aliceTicket || !bobTicket) {
  console.error('Could not create the seed tickets. Is `npm run dev` running?');
  process.exit(1);
}

section('Authentication');
{
  const anonList = await api('/api/tickets');
  check('unauthenticated GET /api/tickets is rejected', anonList.status === 401, `got ${anonList.status}`);

  const anonRest = await rest('/tickets?select=*');
  const leaked = Array.isArray(anonRest.body) ? anonRest.body.length : 0;
  check('anon key alone cannot read tickets from PostgREST', leaked === 0, `${leaked} rows leaked`);
}

section('Customers see only their own tickets');
{
  const list = await api('/api/tickets', { token: alice.token });
  const ids = (list.body?.tickets ?? []).map((t) => t.id);
  check('API list contains own ticket', ids.includes(aliceTicket.id));
  check("API list excludes the other customer's ticket", !ids.includes(bobTicket.id));

  const direct = await api(`/api/tickets/${bobTicket.id}`, { token: alice.token });
  check("GET another customer's ticket returns 404", direct.status === 404, `got ${direct.status}`);

  const restAll = await rest('/tickets?select=id', { token: alice.token });
  const restIds = Array.isArray(restAll.body) ? restAll.body.map((t) => t.id) : [];
  check('PostgREST returns only own rows (RLS)', !restIds.includes(bobTicket.id));

  const restOne = await rest(`/tickets?id=eq.${bobTicket.id}&select=*`, { token: alice.token });
  const got = Array.isArray(restOne.body) ? restOne.body.length : 0;
  check("PostgREST cannot fetch another customer's ticket by id", got === 0, `${got} rows returned`);
}

section('Customers cannot enumerate other users');
{
  // The tickets table is not the only thing worth stealing: an unrestricted
  // profiles table hands over every registered email address.
  const all = await rest('/profiles?select=id,email,role', { token: alice.token });
  const rows = Array.isArray(all.body) ? all.body : [];
  check(
    'reading the whole profiles table returns only own row',
    rows.length === 1 && rows[0]?.id === alice.id,
    `${rows.length} rows returned`,
  );

  const otherCustomer = await rest(`/profiles?id=eq.${bob.id}&select=email`, { token: alice.token });
  const foundCustomer = Array.isArray(otherCustomer.body) ? otherCustomer.body.length : 0;
  check("cannot read another customer's profile", foundCustomer === 0, `${foundCustomer} rows`);

  const agentRow = await rest(`/profiles?id=eq.${agent.id}&select=email`, { token: alice.token });
  const foundAgent = Array.isArray(agentRow.body) ? agentRow.body.length : 0;
  check("cannot read a support agent's profile", foundAgent === 0, `${foundAgent} rows`);
}

section('Customers cannot perform agent actions');
{
  const own = await api(`/api/tickets/${aliceTicket.id}`, {
    token: alice.token,
    method: 'PATCH',
    body: { status: 'resolved' },
  });
  check('customer cannot change status on own ticket', own.status === 403, `got ${own.status}`);

  const other = await api(`/api/tickets/${bobTicket.id}`, {
    token: alice.token,
    method: 'PATCH',
    body: { status: 'resolved' },
  });
  check("customer cannot change status on another customer's ticket", other.status === 403, `got ${other.status}`);

  const restPatch = await rest(`/tickets?id=eq.${aliceTicket.id}`, {
    token: alice.token,
    method: 'PATCH',
    body: { status: 'resolved' },
  });
  const changed = Array.isArray(restPatch.body) && restPatch.body.length > 0;
  check('PostgREST refuses a customer status update (RLS)', !changed);

  const restTitle = await rest(`/tickets?id=eq.${aliceTicket.id}`, {
    token: alice.token,
    method: 'PATCH',
    body: { title: 'rewritten by the owner' },
  });
  check('PostgREST refuses a customer title rewrite', restTitle.status >= 400, `got ${restTitle.status}`);

  const restDelete = await rest(`/tickets?id=eq.${aliceTicket.id}`, {
    token: alice.token,
    method: 'DELETE',
  });
  const afterDelete = await rest(`/tickets?id=eq.${aliceTicket.id}&select=id`, { token: alice.token });
  check(
    'PostgREST refuses ticket deletion',
    (Array.isArray(afterDelete.body) ? afterDelete.body.length : 0) === 1,
    `delete returned ${restDelete.status}`,
  );
}

section('Customers cannot change their role');
{
  const restRole = await rest(`/profiles?id=eq.${alice.id}`, {
    token: alice.token,
    method: 'PATCH',
    body: { role: 'agent' },
  });
  const after = await rest(`/profiles?id=eq.${alice.id}&select=role`, { token: alice.token });
  check(
    'PostgREST refuses profiles.role update',
    after.body?.[0]?.role === 'customer',
    `role is now ${after.body?.[0]?.role} (patch returned ${restRole.status})`,
  );

  // The classic escape hatch: user_metadata is writable by the user, so the
  // role must not be read from there.
  await alice.client.auth.updateUser({ data: { role: 'agent' } });
  const stillCustomer = await rest(`/profiles?id=eq.${alice.id}&select=role`, { token: alice.token });
  check(
    'writing user_metadata.role does not grant agent rights',
    stillCustomer.body?.[0]?.role === 'customer',
  );

  const refreshed = await signIn(alice.email, alice.password);
  const listAsAlice = await api('/api/tickets', { token: refreshed.token });
  const idsAfter = (listAsAlice.body?.tickets ?? []).map((t) => t.id);
  check('still cannot see other tickets after the metadata trick', !idsAfter.includes(bobTicket.id));

  const patchAfter = await api(`/api/tickets/${bobTicket.id}`, {
    token: refreshed.token,
    method: 'PATCH',
    body: { status: 'resolved' },
  });
  check('still cannot patch after the metadata trick', patchAfter.status === 403, `got ${patchAfter.status}`);
}

section('Request bodies cannot be smuggled');
{
  const created = await api('/api/tickets', {
    token: alice.token,
    method: 'POST',
    body: {
      title: 'Mass assignment attempt',
      description: 'Trying to set owner and status directly.',
      customer_id: bob.id,
      status: 'resolved',
    },
  });
  check('extra customer_id is ignored', created.body?.ticket?.customer_id === alice.id);
  check('extra status is ignored', created.body?.ticket?.status === 'open');

  const restInsert = await rest('/tickets', {
    token: alice.token,
    method: 'POST',
    body: { customer_id: bob.id, title: 'Owned by Bob', description: 'Inserted by Alice.' },
  });
  check(
    'PostgREST refuses an insert owned by someone else',
    restInsert.status >= 400,
    `got ${restInsert.status}`,
  );

  const blank = await api('/api/tickets', {
    token: alice.token,
    method: 'POST',
    body: { title: '   ', description: '' },
  });
  check('blank title and description are rejected', blank.status === 400, `got ${blank.status}`);

  const badStatus = await api(`/api/tickets/${aliceTicket.id}`, {
    token: agent.token,
    method: 'PATCH',
    body: { status: 'deleted' },
  });
  check('unknown status value is rejected', badStatus.status === 400, `got ${badStatus.status}`);
}

section('Support agents have the access they need');
{
  const list = await api('/api/tickets', { token: agent.token });
  const ids = (list.body?.tickets ?? []).map((t) => t.id);
  check('agent sees both customers tickets', ids.includes(aliceTicket.id) && ids.includes(bobTicket.id));

  const filtered = await api('/api/tickets?status=open', { token: agent.token });
  const allOpen = (filtered.body?.tickets ?? []).every((t) => t.status === 'open');
  check('agent status filter works', filtered.status === 200 && allOpen);

  const patched = await api(`/api/tickets/${aliceTicket.id}`, {
    token: agent.token,
    method: 'PATCH',
    body: { status: 'in_progress' },
  });
  check('agent can change status', patched.body?.ticket?.status === 'in_progress', `got ${patched.status}`);

  const restTitle = await rest(`/tickets?id=eq.${aliceTicket.id}`, {
    token: agent.token,
    method: 'PATCH',
    body: { title: 'rewritten by an agent' },
  });
  check(
    'agent cannot rewrite the title (column-level grant)',
    restTitle.status >= 400,
    `got ${restTitle.status}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
