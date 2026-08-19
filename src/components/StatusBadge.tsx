import { STATUS_LABELS, type TicketStatus } from '@/types';

const STYLES: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800 ring-amber-200',
  in_progress: 'bg-blue-100 text-blue-800 ring-blue-200',
  resolved: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
};

export default function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      // The status names also appear in the agent's dropdown, so the tests
      // need a way to target the badge specifically.
      data-testid="status-badge"
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
