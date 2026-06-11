import { z } from "zod/v4";

const nullableText = z.string().trim().nullable().optional();
const dateTimeText = z.string().datetime({ offset: true });

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listCustomersQuerySchema = z.object({
  q: z.string().trim().optional(),
});

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "اسم العميل مطلوب"),
  phone: z.string().trim().min(1, "رقم الهاتف مطلوب"),
  whatsapp: nullableText,
  email: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().trim().email("البريد الإلكتروني غير صالح").nullable().optional(),
  ),
  notes: nullableText,
});

export const customerUpdateSchema = customerInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "يجب إرسال حقل واحد على الأقل",
  });

export const saleInputSchema = z
  .object({
    productId: z.number().int().positive(),
    slotId: z.number().int().positive().optional(),
    customerId: z.number().int().positive(),
    price: z.number().nonnegative("السعر يجب ألا يكون سالباً"),
    notes: nullableText,
    payment: z.object({
      amount: z.number().nonnegative("مبلغ الدفع يجب ألا يكون سالباً"),
      method: z.enum(["cash", "transfer", "other"]),
      paidAt: dateTimeText,
      notes: nullableText,
    }),
  });

export const listSubscriptionsQuerySchema = z.object({
  status: z.enum(["active", "expired", "cancelled"]).optional(),
  customerId: z.coerce.number().int().positive().optional(),
});

export const subscriptionNotesSchema = z.object({
  notes: z.string().trim().nullable(),
});

export const cancelSubscriptionInputSchema = z.object({
  refunded: z.boolean().default(false),
});

export function validationError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات الطلب غير صالحة";
}
