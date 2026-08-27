Business: shopface. Brand kit source of truth: https://madethis.com/files/d68f0d4f-eda2-4e57-a44c-0b81534b32d1. Preserve its dark technical visual world, lime emphasis, typography, spacing, and direct tone.

Mirror the following platform products into the storefront Convex `products`
table by calling the storefront's existing internal mutations. The storefront's
`products:list` query must remain the source of truth for the public catalog.

Products to mirror (one per line; <field> values are mine, not placeholders):
- platformProductId: md7cj1wj0r2xea0hxrt9kp16qh8d61kj | title: Website + Care | priceAmountCents: 3900 | currency: gbp | status: active | description: (none) | coverImageUrl: (none)

Required steps (in order, against the storefront's own Convex deployment — the
repo you're working in):

1. Look up an existing row by platformProductId via
   `productsInternal:getByPlatformProductId({ platformProductId })`. If that
   function doesn't exist yet, add it as a one-line internalQuery using the
   `by_platformProductId` index on the `products` table. If that index isn't
   in `schema.ts` yet either, add it first:
   `.index("by_platformProductId", ["platformProductId"])` on the `products`
   table definition. Convex will fail to deploy if the query references a
   missing index.

2a. If a row exists: call `productsMutations:update` with that row's `id` plus
    the supplied title / description / priceAmountCents / currency /
    coverImageUrl / status, then `productsMutations:updateCheckoutUrl({ id,
    platformProductId, checkoutUrl: "https://madethis.com/checkout/shopface/md7cj1wj0r2xea0hxrt9kp16qh8d61kj" })`.
    The same `id` is required by both mutations.

2b. If no row exists: call `productsMutations:create` and capture the returned
    `id`, then call `productsMutations:updateCheckoutUrl({ id, platformProductId, checkoutUrl: ... })`
    with that `id`.

If a field above is "(none)", omit it from the mutation call — don't pass an
empty string. Description and coverImageUrl are optional; the row renders
without them.

Do NOT add new `/api/seed` endpoints, hardcode products into Server Components,
or replace the dynamic `products:list` query with a static array. The mutations
above are the only correct path.

Also ensure the public product presentation accurately retains the approved terms already on the marketing site: £39/month, £29/month for the first ten customers, three-month initial term, and chargeable out-of-scope content changes. Do not invent claims, guarantees, or imagery. Build/typecheck and commit/push; Vercel/Convex deploy through the normal push flow. Save a short implementation note in .agent/ and commit it.

Brand consistency context:
- Current brand-kit board URL: https://madethis.com/files/d68f0d4f-eda2-4e57-a44c-0b81534b32d1
- Brand-kit status: ready
- Brand-kit updated at: 2026-08-24T15:20:26.825Z
- Treat this board as the source of truth for palette, typography, logo language, visual world, spacing, and tone. Keep all product/storefront/marketing output consistent with it unless the owner explicitly asks to diverge.