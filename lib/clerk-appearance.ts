import type { Appearance } from "@clerk/types";

/**
 * Light-touch theming of Clerk's prebuilt components via its documented
 * `appearance.variables` API (not hand-building auth UI) — CSS-variable
 * references so the widget follows whichever theme class is active on
 * <html>, matching `lib/design-tokens.ts` without duplicating values.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "hsl(var(--accent))",
    colorBackground: "hsl(var(--surface-raised))",
    colorText: "hsl(var(--ink))",
    colorTextSecondary: "hsl(var(--ink-muted))",
    colorInputBackground: "hsl(var(--surface))",
    colorInputText: "hsl(var(--ink))",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-sans)",
  },
};
