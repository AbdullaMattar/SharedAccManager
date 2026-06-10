import { z } from "zod/v4";

const nullableNotes = z.string().trim().max(2000).nullable().optional();

export const renewalInputSchema = z.object({
  durationDays: z.coerce.number().int().min(1).max(3660),
  price: z.coerce.number().min(0),
  paymentMethod: z.enum(["cash", "transfer", "other"]),
  paidAt: z.iso.datetime({ offset: true }),
  notes: nullableNotes,
});

export const settingsUpdateSchema = z
  .object({
    reminder_lead_days: z.coerce.number().int().min(1).max(365).optional(),
    reminder_recipient: z.enum(["staff", "customer", "both"]).optional(),
    grace_days: z.coerce.number().int().min(0).max(365).optional(),
    business_name: z.string().trim().min(1).max(200).optional(),
    currency: z.string().trim().min(1).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "يجب إرسال إعداد واحد على الأقل");

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "staff"]).default("staff"),
});

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
    role: z.enum(["admin", "staff"]).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "يجب إرسال تعديل واحد على الأقل");

export const passwordResetSchema = z.object({
  password: z.string().min(8).max(200),
});

export const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(365).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
