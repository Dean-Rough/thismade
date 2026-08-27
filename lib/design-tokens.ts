/**
 * thismade design-token spike (THI-15 / THI-14 Part 8 open question 2).
 *
 * Own visual identity, not a MadeThis reskin: warm-neutral surface + near-black
 * ink (not MadeThis's cream/charcoal), a terracotta accent (not a generic SaaS
 * blue), semantic scales kept separate for confirmation state vs credit-usage
 * state per THI-14 Part 2.2 even though today they share hues 1:1 — they are
 * free to diverge later without a rename.
 *
 * These values are the canonical palette. `app/globals.css` defines them as
 * CSS custom properties (HSL triplets, consumed via `hsl(var(--x))` so
 * Tailwind's opacity modifiers work) and `tailwind.config.ts` maps Tailwind
 * color names onto those same variables. Update colors here first, then copy
 * the HSL triplet into `app/globals.css` — see the comment at the top of that
 * file's `:root`/`.dark` blocks.
 */

export const colorTokens = {
  light: {
    surface: "32 27% 96%", // warm off-white, not pure white
    surfaceRaised: "0 0% 100%", // cards sit one step lighter than the page
    ink: "27 19% 10%", // warm near-black, not pure black
    inkMuted: "25 10% 42%",
    border: "30 18% 87%",
    accent: "18 68% 45%", // terracotta — confident, not SaaS-blue
    accentInk: "0 0% 100%",
    confirmationPending: "43 74% 42%",
    confirmationApproved: "150 42% 33%",
    confirmationRejected: "356 63% 43%",
    creditOk: "150 42% 33%",
    creditWarning: "38 78% 46%",
    creditExhausted: "356 63% 43%",
  },
  dark: {
    surface: "25 15% 8%",
    surfaceRaised: "24 13% 12%",
    ink: "36 33% 94%",
    inkMuted: "30 12% 65%",
    border: "27 12% 20%",
    accent: "22 78% 62%",
    accentInk: "20 30% 10%",
    confirmationPending: "43 74% 62%",
    confirmationApproved: "150 40% 55%",
    confirmationRejected: "356 70% 66%",
    creditOk: "150 40% 55%",
    creditWarning: "38 78% 62%",
    creditExhausted: "356 70% 66%",
  },
} as const;

export type ColorToken = keyof typeof colorTokens.light;

/** 1px hairline card borders + a consistent card radius, per THI-14 Part 2.2 "shape language." */
export const radiusTokens = {
  sm: "0.375rem",
  md: "0.625rem",
  lg: "0.875rem",
  card: "0.75rem",
  full: "9999px",
} as const;

/** Named layout constants for the dashboard shell (THI-14 Part 4.1), not a full spacing-scale reinvention. */
export const layoutTokens = {
  navRailWidth: "16rem",
  navRailCollapsedWidth: "4.5rem",
  topBarHeight: "3.5rem",
  creditStripHeight: "3.5rem",
} as const;

/**
 * Font role assignments (THI-14 Part 2.2/2.3): a workhorse sans for UI/body,
 * a serif used sparingly for marketing headlines/empty-states only (never
 * dense dashboard UI), and a mono face for API keys, credit numbers, and
 * technical timeline events. Chosen deliberately distinct from MadeThis's
 * verified pairing (Inter / Instrument Serif & Inria Serif / Geist Mono) —
 * see `lib/fonts.ts` for the next/font wiring.
 */
export const fontRoleTokens = {
  sans: "var(--font-sans)",
  serif: "var(--font-serif)",
  mono: "var(--font-mono)",
} as const;
