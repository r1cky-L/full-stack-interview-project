'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch } from '@/lib/api';
import { STATUS_LABELS, TICKET_STATUSES, type Ticket, type TicketStatus, type UserRole } from '@/types';

export default function TicketList({ role }: { role: UserRole }) {
  const isAgent = role === 'agent';
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `cancelled` drops the response of a filter change the user has already
    // moved on from, so a slow request cannot overwrite a newer one.
    let cancelled = false;
    const query = statusFilter ? `?status=${statusFilter}` : '';

    apiFetch<{ tickets: Ticket[] }>(`/api/tickets${query}`)
      .then((data) => {
        if (cancelled) return;
        setTickets(data.tickets);
        setError(null);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        setError(cause.message);
        setTickets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{isAgent ? 'All tickets' : 'My tickets'}</h1>

        {isAgent && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-slate-600">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TicketStatus | '')}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              {TICKET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        )}

        {!isAgent && (
          <Link
            href="/tickets/new"
            className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            New ticket
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {tickets === null && <p className="mt-6 text-sm text-slate-500">Loading...</p>}

      {tickets?.length === 0 && !error && (
        <p className="mt-6 text-sm text-slate-500">No tickets yet.</p>
      )}

      <ul className="mt-4 space-y-2">
        {tickets?.map((ticket) => (
          <li key={ticket.id}>
            <Link
              href={`/tickets/${ticket.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-slate-400"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{ticket.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {new Date(ticket.created_at).toLocaleString()}
                  {isAgent && ticket.customer_email && <> &middot; {ticket.customer_email}</>}
                </p>
              </div>
              <StatusBadge status={ticket.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
