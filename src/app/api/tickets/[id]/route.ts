import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { forbidden, jsonError, notFound, readJson, unauthorized } from '@/lib/http';
import { TICKET_COLUMNS, UUID_PATTERN, toTicket } from '@/lib/tickets';
import { formatZodError, updateTicketSchema } from '@/lib/validation';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/tickets/:id
 *
 * A customer asking for somebody else's ticket gets 404 rather than 403, so the
 * response does not reveal whether that ticket exists.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return notFound();

  let query = ctx.supabase.from('tickets').select(TICKET_COLUMNS).eq('id', id);
  if (ctx.profile.role !== 'agent') {
    query = query.eq('customer_id', ctx.profile.id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return jsonError(500, error.message);
  if (!data) return notFound();

  return NextResponse.json({ ticket: toTicket(data) });
}

/** PATCH /api/tickets/:id - change the status. Support agents only. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // Layer 1: the application refuses non-agents.
  // Layer 2: the tickets_update_agent policy and the column-level
  //          GRANT UPDATE (status) would refuse them at the database anyway.
  if (ctx.profile.role !== 'agent') return forbidden();

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return notFound();

  const parsed = updateTicketSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(400, formatZodError(parsed.error));

  // status is the only field written; title/description are not updatable.
  const { data, error } = await ctx.supabase
    .from('tickets')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select(TICKET_COLUMNS)
    .maybeSingle();

  if (error) return jsonError(400, error.message);
  if (!data) return notFound();

  return NextResponse.json({ ticket: toTicket(data) });
}
