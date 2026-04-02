import { z } from 'zod';

export const CreateTournamentSchema = z.object({
  name:        z.string().min(3).max(128),
  bracketSize: z.number().int().refine(s => [8, 16, 32, 64].includes(s), 'Must be 8, 16, 32, or 64'),
  entryFee:    z.string().regex(/^\d+(\.\d{1,9})?$/, 'Invalid entry fee'),
  startsAt:    z.string().min(1),
});

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;
