import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import SignOutButton from '@/components/SignOutButton';

export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');

  const { profile } = ctx;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-6 py-4">
          <Link href="/tickets" className="font-semibold">
            Secure Support Desk
          </Link>
          <span className="ml-auto text-sm text-slate-600">{profile.email}</span>
          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium text-white">
            {profile.role === 'agent' ? 'Support agent' : 'Customer'}
          </span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
