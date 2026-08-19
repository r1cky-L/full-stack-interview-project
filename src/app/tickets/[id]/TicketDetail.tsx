'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch } from '@/lib/api';
import { STATUS_LABELS, TICKET_STATUSES, type Ticket, type TicketStatus, type UserRole } from '@/types';

export default function TicketDetail({ id, role }: { id: string; role: UserRole }) {
  const isAgent = role === 'agent';
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ ticket: Ticket }>(`/api/tickets/${id}`)
      .then((data) => setTicket(data.ticket))
      .catch((cause: Error) => setError(cause.message));
  }, [id]);

  async function changeStatus(status: TicketStatus) {
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<{ ticket: Ticket }>(`/api/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setTicket(data.ticket);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !ticket) {
    return (
      <section>
        <Link href="/tickets" className="text-sm text-slate-600 hover:text-slate-900">
          &larr; Back to tickets
        </Link>
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      </section>
    );
  }

  if (!ticket) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <section>
      <Link href="/tickets" className="text-sm text-slate-600 hover:text-slate-900">
        &larr; Back to tickets
      </Link>

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <h1 className="text-xl font-semibold">{ticket.title}</h1>
        <StatusBadge status={ticket.status} />
      </div>

      <dl className="mt-2 text-xs text-slate-500">
        <div className="flex gap-1">
          <dt>Created</dt>
          <dd>{new Date(ticket.created_at).toLocaleString()}</dd>
        </div>
        {ticket.customer_email && (
          <div className="flex gap-1">
            <dt>Customer</dt>
            <dd>{ticket.customer_email}</dd>
          </div>
        )}
      </dl>

      <p className="mt-6 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        {ticket.description}
      </p>

      {/* Rendered for agents only. The PATCH route rejects non-agents anyway,
          so hiding this control is convenience, not the access check. */}
      {isAgent && (
        <div className="mt-6">
          <label htmlFor="status" className="block text-sm font-medium">
            Change status
          </label>
          <select
            id="status"
            value={ticket.status}
            disabled={saving}
            onChange={(e) => changeStatus(e.target.value as TicketStatus)}
            className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
