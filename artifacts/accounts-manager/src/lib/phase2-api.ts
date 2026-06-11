import {
  useCancelSubscription,
  useCreateCustomer,
  useCreateSale,
  useDeleteCustomer,
  useGetCustomer,
  useGetSaleAvailability,
  useGetSubscription,
  useListCustomers,
  useListSubscriptions,
  useRefundSubscription,
  useUpdateCustomer,
  useUpdateSubscriptionNotes,
  type Customer as GeneratedCustomer,
  type CustomerDetail,
  type CustomerInput,
  type FreeSlot,
  type SaleProductAvailability,
  type SubscriptionSummary,
} from "@workspace/api-client-react";

export {
  useCancelSubscription,
  useCreateCustomer,
  useCreateSale,
  useDeleteCustomer,
  useGetCustomer,
  useGetSubscription,
  useListCustomers,
  useListSubscriptions,
  useRefundSubscription,
  useUpdateCustomer,
  useUpdateSubscriptionNotes as useUpdateSubscription,
};

export function useListAvailableProducts() {
  const query = useGetSaleAvailability();
  return { ...query, data: query.data?.products };
}

export function useListAvailableSlots(
  params?: { productId?: number },
  _options?: { query?: { enabled?: boolean } },
) {
  const query = useGetSaleAvailability();
  const slots = query.data?.freeSlots;
  return {
    ...query,
    data:
      params?.productId && slots
        ? slots.filter((slot) => slot.productId === params.productId)
        : slots,
  };
}

export type {
  CustomerInput,
  SubscriptionSummary,
};
export type Customer = GeneratedCustomer &
  Partial<Pick<CustomerDetail, "totalSpent" | "subscriptions">>;
export type AvailableProduct = SaleProductAvailability;
export type AvailableSlot = FreeSlot;
