# shopface production fonts and logo correction

## Approved source

The owner-provided Shopface Design System archive (Dropbox share supplied on August 25, 2026) is the asset source used for this correction. Its `tokens/fonts.css` replaces the previous Space Grotesk direction with `Archivo` for display and interface/body typography, retaining `IBM Plex Mono` for system labels, preview metadata and terminal-style details.

## Applied fonts

- `Archivo` is loaded with `next/font/google` as the locally self-hosted production font. It supplies `--font-sans` and `--font-heading`, so headings, body copy, navigation and buttons follow the approved hierarchy without relying on a runtime Google Fonts stylesheet.
- `IBM Plex Mono` remains loaded with `next/font/google` for `--font-mono`, with the approved 400, 500 and 600 weights.

## Applied logo assets

The visible storefront logo is the canonical two-tone lockup from the supplied design system: `public/brand/shopface-lockup-duo.svg` (lime mark and stone wordmark for Shopface's dark surfaces). It replaces the prior unrelated platform fallback asset and no longer depends on `NEXT_PUBLIC_BRAND_LOGO`.

The matching approved mark files are committed under `public/brand/` for metadata and favicon use:

- `shopface-mark-charcoal.svg` for light browser chrome
- `shopface-mark-stone.svg` for dark browser chrome
- `shopface-mark-lime.svg` retained as the supplied brand mark variant

The header and footer use the outlined lockup artwork with meaningful `shopface` alt text. No offer, handoff, checkout, payment, preview or outreach behavior was changed.
