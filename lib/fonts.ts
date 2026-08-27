import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";

/**
 * Self-hosted via next/font (files served from our own domain at build time,
 * no external font-CDN request at runtime) and deliberately distinct from
 * MadeThis's verified pairing (Inter / Instrument Serif & Inria Serif / Geist
 * Mono) per THI-14 Part 2.2's "own visual identity, not a reskin" principle.
 */
export const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const fontVariables = `${sans.variable} ${serif.variable} ${mono.variable}`;
