import { useMutation, useQuery } from "@tanstack/react-query";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== undefined && params.set(key, String(value)));
  return params.size ? `?${params}` : "";
};

export type ExpiringSubscription = { id: number; customerName: string; phone: string; whatsapp?: string | null; productName: string; accountLabel: string; expiryDate: string; daysRemaining: number; price: number; defaultDurationDays: number };
export type DashboardData = { expiringCounts: { oneDay: number; threeDays: number; sevenDays: number }; overdue: ExpiringSubscription[]; freeSlots: { productId: number; productName: string; freeCount: number; totalSlots: number }[]; totals: { activeSubscriptions: number; totalAccounts: number; monthlyRevenue: number }; currency?: string; businessName?: string };
export type Settings = { reminderLeadDays: number; reminderRecipient: "staff" | "customer" | "both"; graceDays: number; businessName: string; currency: string };
export type AdminUser = { id: number; name: string; email: string; role: "admin" | "staff"; enabled: boolean };
export type AuditEntry = { id: number; userName?: string | null; action: string; entityType: string; entityId?: number | null; createdAt: string };
export type RevenueReport = { total: number; currency?: string; products: { productId: number; productName: string; revenue: number; paymentsCount?: number }[] };

type RawSubscription = { id: number; customerName: string; customerPhone: string; customerWhatsapp?: string | null; productName: string; accountLabel: string; expiryDate: string; price: number; productDefaultDurationDays: number };
const normalizeSubscription = (item: RawSubscription): ExpiringSubscription => ({
  ...item, phone: item.customerPhone, whatsapp: item.customerWhatsapp, defaultDurationDays: item.productDefaultDurationDays,
  daysRemaining: Math.ceil((new Date(`${item.expiryDate}T23:59:59`).getTime() - Date.now()) / 86400000),
});
export const useGetDashboard = () => useQuery({ queryKey: ["phase3", "dashboard"], queryFn: async () => {
  const raw = await request<any>("/api/dashboard");
  return { expiringCounts: { oneDay: raw.expiringCounts["1"] || 0, threeDays: raw.expiringCounts["3"] || 0, sevenDays: raw.expiringCounts["7"] || 0 }, overdue: raw.overdue.map(normalizeSubscription), freeSlots: raw.freeSlotsByProduct.map((item: any) => ({ ...item, freeCount: item.freeSlots, totalSlots: item.totalSlots ?? 0 })), totals: raw.totals, currency: raw.settings.currency, businessName: raw.settings.businessName } as DashboardData;
} });
export const useListExpiringSubscriptions = (days?: number) => useQuery({ queryKey: ["phase3", "expiring", days], queryFn: async () => {
  const raw = await request<{ subscriptions: RawSubscription[] }>(`/api/expiring${query({ days })}`);
  return raw.subscriptions.map(normalizeSubscription);
} });
export const useRenewSubscription = () => useMutation({ mutationFn: ({ id, data }: { id: number; data: { durationDays: number; price: number; paymentMethod: string; notes?: string } }) => request(`/api/subscriptions/${id}/renew`, { method: "POST", body: JSON.stringify({ ...data, paidAt: new Date().toISOString() }) }) });
export const useGetSettings = () => useQuery({ queryKey: ["phase3", "settings"], queryFn: () => request<Settings>("/api/settings") });
export const useUpdateSettings = () => useMutation({ mutationFn: (data: Settings) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify({ reminder_lead_days: data.reminderLeadDays, reminder_recipient: data.reminderRecipient, grace_days: data.graceDays, business_name: data.businessName, currency: data.currency }) }) });
const normalizeUser = (user: any): AdminUser => ({ ...user, enabled: !user.disabled });
export const useListUsers = () => useQuery({ queryKey: ["phase3", "users"], queryFn: async () => (await request<any[]>("/api/users")).map(normalizeUser) });
export const useCreateUser = () => useMutation({ mutationFn: async ({ enabled: _enabled, ...data }: Omit<AdminUser, "id"> & { password: string }) => normalizeUser(await request<AdminUser>("/api/users", { method: "POST", body: JSON.stringify(data) })) });
export const useUpdateUser = () => useMutation({ mutationFn: async ({ id, data }: { id: number; data: Partial<AdminUser> }) => {
  const { enabled, ...rest } = data; return normalizeUser(await request<AdminUser>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ ...rest, ...(enabled === undefined ? {} : { disabled: !enabled }) }) }));
} });
export const useResetUserPassword = () => useMutation({ mutationFn: ({ id, password }: { id: number; password: string }) => request(`/api/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }) });
export const useListAdminAuditLog = (action?: string, offset?: number) => useQuery({ queryKey: ["phase3", "audit", action, offset], queryFn: async () => (await request<any[]>(`/api/stats/audit-log${query({ action, offset })}`)).map((item) => ({ ...item, entityType: item.entity })) as AuditEntry[] });
export const useGetRevenueReport = () => useQuery({ queryKey: ["phase3", "revenue"], queryFn: async () => { const raw = await request<any>("/api/reports/revenue"); return { total: raw.revenue, products: raw.byProduct, currency: raw.currency } as RevenueReport; } });
