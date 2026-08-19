import { z } from 'zod';
import { TICKET_STATUSES } from '@/types';

/**
 * Request bodies are parsed through these schemas and only the resulting
 * fields are ever written. The raw body is never spread into a query, so a
 * caller cannot smuggle in `customer_id` or `status` on create.
 */

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(5000, 'Description is too long'),
});

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});

export const statusFilterSchema = z.enum(TICKET_STATUSES).optional();

/** Flattens a ZodError into a single human-readable sentence. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ');
}
