import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { jsonError, readJson, unauthorized } from '@/lib/http';
import { TICKET_COLUMNS, toTicket } from '@/lib/tickets';
import { createTicketSchema, formatZodError, statusFilterSchema } from '@/lib/validation';

/**
 * GET /api/tickets?status=open
 *
 * Customers receive only their own tickets; support agents receive all of them.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // `?status=` with no value means "no filter", the same as omitting it.
  const filter = statusFilterSchema.safeParse(
    request.nextUrl.searchParams.get('status') || undefined,
  );
  if (!filter.success) return jsonError(400, 'Unknown status filter.');

  let query = ctx.supabase
    .from('tickets')
    .select(TICKET_COLUMNS)
    .order('created_at', { ascending: false });

  // Layer 1: the application scopes the query for customers.
  // Layer 2: the tickets_select_own RLS policy would strip other people's rows
  //          even if this line were deleted.
  if (ctx.profile.role !== 'agent') {
    query = query.eq('customer_id', ctx.profile.id);
  }
  if (filter.data) {
    query = query.eq('status', filter.data);
  }

  const { data, error } = await query;
  if (error) return jsonError(500, error.message);

  return NextResponse.json({ tickets: (data ?? []).map(toTicket) });
}

/** POST /api/tickets - create a ticket owned by the caller. */
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const parsed = createTicketSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(400, formatZodError(parsed.error));

  // Only these three columns are written. customer_id comes from the verified
  // session rather than the request body, and status is left to the database
  // default of 'open' -- so neither can be smuggled in by the caller.
  const { data, error } = await ctx.supabase
    .from('tickets')
    .insert({
      customer_id: ctx.profile.id,
      title: parsed.data.title,
      description: parsed.data.description,
    })
    .select(TICKET_COLUMNS)
    .single();

  if (error) return jsonError(400, error.message);

  return NextResponse.json({ ticket: toTicket(data) }, { status: 201 });
}
