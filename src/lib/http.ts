import { NextResponse } from 'next/server';

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export const unauthorized = () => jsonError(401, 'You must be signed in.');
export const forbidden = () => jsonError(403, 'You are not allowed to do that.');
export const notFound = () => jsonError(404, 'Ticket not found.');

/** Parses a JSON body, returning null when it is absent or malformed. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
