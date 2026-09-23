import { z } from 'zod';

export const businessAnnotationPayloadSchema = z.object({
  transactionIntent: z.string().nullable(),
  productOrService: z.string().nullable(),
  quantity: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  amountPaid: z.string().nullable(),
  outstandingDebt: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  transactionReference: z.string().nullable(),
}).strict();

export const annotationSchema = z.object({
  id: z.string().uuid(), recordingId: z.string().uuid(), annotationType: z.string().min(1), schemaVersion: z.string().min(1),
  payload: z.record(z.string(), z.unknown()), source: z.enum(['human', 'automatic']), revisionNumber: z.number().int().positive(),
  supersedesId: z.string().uuid().nullable(), createdAt: z.string().datetime({ offset: true }), createdBy: z.string().nullable(),
});

export type BusinessAnnotationPayload = z.infer<typeof businessAnnotationPayloadSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
