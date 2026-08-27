import type { Config } from "tailwindcss";

import { fontRoleTokens, layoutTokens, radiusTokens } from "./lib/design-tokens";

/** hsl(var(--x) / <alpha-value>) lets Tailwind opacity modifiers (e.g. `bg-accent/50`) work against CSS-variable colors. */
function hslVar(name: string) {
  return `hsl(var(--${name}) / <alpha-value>)`;
}

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: hslVar("surface"),
        "surface-raised": hslVar("surface-raised"),
        ink: hslVar("ink"),
        "ink-muted": hslVar("ink-muted"),
        border: hslVar("border"),
        accent: hslVar("accent"),
        "accent-ink": hslVar("accent-ink"),
        confirmation: {
          pending: hslVar("confirmation-pending"),
          approved: hslVar("confirmation-approved"),
          rejected: hslVar("confirmation-rejected"),
        },
        credit: {
          ok: hslVar("credit-ok"),
          warning: hslVar("credit-warning"),
          exhausted: hslVar("credit-exhausted"),
        },
      },
      borderRadius: {
        sm: radiusTokens.sm,
        md: radiusTokens.md,
        lg: radiusTokens.lg,
        card: radiusTokens.card,
      },
      fontFamily: {
        sans: [fontRoleTokens.sans, "system-ui", "sans-serif"],
        serif: [fontRoleTokens.serif, "ui-serif", "serif"],
        mono: [fontRoleTokens.mono, "ui-monospace", "monospace"],
      },
      spacing: {
        "nav-rail": layoutTokens.navRailWidth,
        "nav-rail-collapsed": layoutTokens.navRailCollapsedWidth,
        "top-bar": layoutTokens.topBarHeight,
        "credit-strip": layoutTokens.creditStripHeight,
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
