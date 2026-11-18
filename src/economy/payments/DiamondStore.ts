/** FUTURE real-money Diamond purchases — architecture only. NOTHING here charges money, talks to a
 *  payment provider, or fakes a confirmation. Choosing/connecting a provider requires the owner's approval.
 *
 *  Secure flow (server-validated):
 *    1. client  → POST /diamonds/orders {packId, idempotencyKey}           (no price/amount from client)
 *    2. server  → creates order (pending) + provider checkout session / store purchase intent
 *    3. client  → provider UI (Stripe Checkout / Apple IAP / Google Play Billing)
 *    4. provider→ webhook to server (signature verified) / server verifies the store receipt
 *    5. server  → in ONE transaction: order paid → diamond ledger 'iap_grant' (idempotent on provider id)
 *    6. client  ← refreshes balances (GET /economy/me); never credits itself
 *  Refunds/chargebacks: provider webhook → 'refund' entry (may go negative → account flagged, server-side). */
export interface DiamondPack { id: string; diamonds: number; bonus: number; /** display only — real price comes from the store/provider */ priceLabel: string }
export const DIAMOND_PACKS: DiamondPack[] = [
  { id: 'pack_s', diamonds: 50, bonus: 0, priceLabel: '—' }, { id: 'pack_m', diamonds: 120, bonus: 10, priceLabel: '—' },
  { id: 'pack_l', diamonds: 300, bonus: 40, priceLabel: '—' }, { id: 'pack_xl', diamonds: 700, bonus: 120, priceLabel: '—' },
];
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export interface DiamondOrder { id: string; packId: string; status: OrderStatus; providerRef?: string; createdAt: number }
/** Implemented later by the server-backed client (StripeGateway, AppStoreGateway, PlayBillingGateway…). */
export interface PaymentGateway {
  readonly available: boolean; readonly name: string;
  createOrder(packId: string, idempotencyKey: string): Promise<{ order: DiamondOrder; redirectUrl?: string }>;
  orderStatus(orderId: string): Promise<DiamondOrder>;
}
/** The only gateway shipped today: always unavailable, never pretends a payment succeeded. */
export class UnavailablePaymentGateway implements PaymentGateway {
  readonly available = false; readonly name = 'aucun (non connecté)';
  async createOrder(): Promise<never> { throw new Error('Paiements non activés : aucun fournisseur connecté (validation du propriétaire requise).'); }
  async orderStatus(): Promise<never> { throw new Error('Paiements non activés'); }
}
