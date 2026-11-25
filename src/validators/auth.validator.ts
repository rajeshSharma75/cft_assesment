import { z } from 'zod';

export const devTokenSchema = {
  body: z.object({
    email: z.string().trim().email('A valid email is required'),
  }),
};

export type DevTokenInput = z.infer<typeof devTokenSchema.body>;
