import type { Ticket } from '@/types';

/**
 * Columns selected for every ticket response. `profiles(email)` is an embedded
 * read of the owner's profile -- it resolves to the email for a support agent
 * and to null for a customer looking at anything but their own ticket, because
 * the profiles policies decide what is visible.
 */
export const TICKET_COLUMNS =
  'id, customer_id, title, description, status, created_at, updated_at, profiles(email)';

type EmbeddedProfile = { email: string } | { email: string }[] | null;
type TicketRow = Omit<Ticket, 'customer_email'> & { profiles: EmbeddedProfile };

/** Flattens the embedded profile into a plain `customer_email` field. */
export function toTicket(row: TicketRow): Ticket {
  const { profiles, ...rest } = row;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  return { ...rest, customer_email: profile?.email ?? null };
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
