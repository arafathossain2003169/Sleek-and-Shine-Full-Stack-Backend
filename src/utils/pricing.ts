/**
 * Single source of truth for "what does the customer pay per unit".
 * A sale price only counts when it is > 0 and strictly lower than the regular price.
 */
export function normalizeSalePrice(
  base: number | string,
  sale: number | string | null | undefined
): number | null {
  if (sale === null || sale === undefined) return null;
  const b = Number(base);
  const s = Number(sale);
  if (!Number.isFinite(s) || s <= 0 || s >= b) return null;
  return s;
}

export function effectivePrice(
  base: number | string,
  sale: number | string | null | undefined
): number {
  return normalizeSalePrice(base, sale) ?? Number(base);
}

interface PricedProduct {
  base_price: string | number;
  sale_price: string | number | null;
}
interface PricedVariant {
  price: string | number | null;
  sale_price: string | number | null;
}

/** Unit price for a product, or for one of its variants when a variant is chosen. */
export function unitPriceFor(product: PricedProduct, variant?: PricedVariant | null): number {
  if (!variant) return effectivePrice(product.base_price, product.sale_price);
  if (variant.price !== null && variant.price !== undefined) {
    return effectivePrice(variant.price, variant.sale_price);
  }
  // Variant inherits the product's regular price; its own sale price (if any) wins.
  return effectivePrice(product.base_price, variant.sale_price ?? product.sale_price);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
