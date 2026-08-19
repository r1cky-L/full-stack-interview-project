import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import TicketList from './TicketList';

export default async function TicketsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');

  // The role only decides what this page renders. Every API call it makes is
  // authorised again on the server, so a tampered client changes nothing.
  return <TicketList role={ctx.profile.role} />;
}
