/**
 * Payment provider interface.
 *
 * WIZZ never touches card details: the provider returns a checkout URL and the
 * client redirects the user there. Set VITE_PAYMENT_PROVIDER (and the
 * provider's keys) to enable checkout; without it every payment surface shows
 * a clearly labeled "coming soon" state instead of a broken button.
 */

export interface CheckoutRequest {
  amountCents: number;
  currency: string;
  /** Internal reference (payment id / campaign id) reconciled on webhook. */
  reference: string;
  description: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
}

export interface PaymentProvider {
  readonly id: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
}

/**
 * Active provider, or null when payments are not configured. Providers
 * register themselves here once their keys exist — no fake checkouts.
 */
export function getPaymentProvider(): PaymentProvider | null {
  const id = import.meta.env?.["VITE_PAYMENT_PROVIDER"] as string | undefined;
  if (!id) return null;
  // Example wiring once keys are available:
  // if (id === "stripe" && import.meta.env?.["VITE_STRIPE_PUBLISHABLE_KEY"]) {
  //   return stripeProvider(import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"]);
  // }
  return null;
}
