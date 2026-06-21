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
export type RevenueReport = {
  month: string;
  total: number;
  currency?: string;
  paymentsCount: number;
  avgPayment: number;
  prevMonthRevenue: number;
  monthly: { month: string; revenue: number }[];
  products: { productId: number; productName: string; revenue: number; paymentsCount?: number }[];
};
export type PlatformOrg = {
  id: number;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  ownerEmail?: string | null;
  usersCount: number;
  productsCount: number;
  accountsCount: number;
  customersCount: number;
  subscriptionsCount: number;
  paymentsCount: number;
};

export type PublicStoreProduct = {
  id: number;
  name: string;
  service: string;
  price: number;
  durationDays: number;
  freeSlotCount: number;
  available: boolean;
  displayName: string;
  description: string;
  imageUrl: string | null;
};

export type ProductStoreMeta = {
  id: number;
  productName: string;
  service: string;
  displayName: string;
  description: string;
  imageUrl: string | null;
};

export type PublicStore = {
  name: string;
  description: string;
  whatsappNumber: string;
  currency: string;
  products: PublicStoreProduct[];
};

export type WebsiteSettings = {
  platformEnabled: boolean;
  enabled: boolean;
  slug: string;
  whatsapp: string;
  name: string;
  description: string;
  publicUrl: string | null;
  products: ProductStoreMeta[];
};

export type WebsiteUpdate = Partial<Pick<WebsiteSettings, "enabled" | "slug" | "whatsapp" | "name" | "description">>;

export type PlatformWebsiteOrg = {
  orgId: number;
  orgName: string;
  orgStatus: "active" | "suspended";
  platformEnabled: boolean;
};

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
export const useGetRevenueReport = (month?: string) => useQuery({
  queryKey: ["phase3", "revenue", month],
  queryFn: async () => {
    const raw = await request<any>(`/api/reports/revenue${query({ month })}`);
    return {
      month: raw.month,
      total: raw.revenue,
      currency: raw.currency,
      paymentsCount: raw.paymentsCount ?? 0,
      avgPayment: raw.avgPayment ?? 0,
      prevMonthRevenue: raw.prevMonthRevenue ?? 0,
      monthly: raw.monthly ?? [],
      products: raw.byProduct,
    } as RevenueReport;
  },
});
export const usePlatformOrgs = () => useQuery({
  queryKey: ["platform", "orgs"],
  queryFn: () => request<PlatformOrg[]>("/api/platform/orgs"),
});
export const useSuspendOrg = () => useMutation({
  mutationFn: ({ id }: { id: number }) => request(`/api/platform/orgs/${id}/suspend`, { method: "POST" }),
});
export const useUnsuspendOrg = () => useMutation({
  mutationFn: ({ id }: { id: number }) => request(`/api/platform/orgs/${id}/unsuspend`, { method: "POST" }),
});
export const useDeleteOrg = () => useMutation({
  mutationFn: ({ id }: { id: number }) => request(`/api/platform/orgs/${id}`, { method: "DELETE" }),
});
export const useResetOrgOwnerPassword = () => useMutation({
  mutationFn: ({ id, password }: { id: number; password: string }) =>
    request(`/api/platform/orgs/${id}/reset-owner-password`, { method: "POST", body: JSON.stringify({ password }) }),
});

export async function downloadBackup(passphrase: string): Promise<void> {
  const response = await fetch("/api/backup/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  if (!response.ok) throw new Error(await response.text());

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "backup.xlsx";

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const useGetPublicStore = (slug: string) => useQuery({
  queryKey: ["store", slug],
  queryFn: () => request<PublicStore>(`/api/store/${encodeURIComponent(slug)}`),
  retry: false,
});

export const useGetWebsiteSettings = () => useQuery({
  queryKey: ["website"],
  queryFn: () => request<WebsiteSettings>("/api/website"),
});

export const useUpdateWebsiteSettings = () => useMutation({
  mutationFn: (data: WebsiteUpdate) => request<WebsiteSettings>("/api/website", {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
});

export const usePlatformWebsites = () => useQuery({
  queryKey: ["platform", "websites"],
  queryFn: () => request<PlatformWebsiteOrg[]>("/api/platform/websites"),
});

export const useUpdatePlatformWebsite = () => useMutation({
  mutationFn: ({ orgId, platformEnabled }: { orgId: number; platformEnabled: boolean }) =>
    request<{ ok: true }>(`/api/platform/websites/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ platformEnabled }),
    }),
});

export const useUpdateProductMeta = () => useMutation({
  mutationFn: ({ productId, name, description }: { productId: number; name?: string; description?: string }) =>
    request<ProductStoreMeta>(`/api/website/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ name, description }),
    }),
});

export const useUploadProductImage = () => useMutation({
  mutationFn: ({ productId, file }: { productId: number; file: File }) => {
    const formData = new FormData();
    formData.append("image", file);
    return fetch(`/api/website/products/${productId}/image`, {
      method: "POST",
      body: formData,
      credentials: "include",
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ imageUrl: string }>;
    });
  },
});

export const useDeleteProductImage = () => useMutation({
  mutationFn: (productId: number) =>
    request<{ ok: true }>(`/api/website/products/${productId}/image`, { method: "DELETE" }),
});
