function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

// These must be written as literal `process.env.NEXT_PUBLIC_*` member accesses.
// Next.js substitutes those textually when it builds the client bundle; a
// dynamic lookup such as `process.env[name]` is left untouched and reads an
// empty object in the browser, which crashes the page at hydration while the
// server keeps working perfectly.
//
// Both values are safe to expose. The anon key carries no privileges of its
// own -- every request it makes is still subject to the row level security
// policies in supabase/schema.sql.
//
// There is deliberately no service_role key anywhere in this project.
export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
