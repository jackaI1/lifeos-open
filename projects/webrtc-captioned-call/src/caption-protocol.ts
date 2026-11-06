import { z } from 'zod';
const captionSchema = z.object({
  type: z.literal('caption'), version: z.literal(1),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  text: z.string().trim().min(1).max(512),
}).strict();
export type Caption = z.infer<typeof captionSchema>;
export function parseCaption(raw: unknown): Caption | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try { return captionSchema.parse(JSON.parse(raw)); } catch { return null; }
}
