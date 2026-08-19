export const TICKET_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export type UserRole = 'customer' | 'agent';

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
}

export interface Ticket {
  id: string;
  customer_id: string;
  title: string;
  description: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  /** Only populated for support agents, who may read other profiles. */
  customer_email: string | null;
}
