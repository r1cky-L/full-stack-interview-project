import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import TicketDetail from './TicketDetail';

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');

  const { id } = await params;
  return <TicketDetail id={id} role={ctx.profile.role} />;
}
