# shopface outreach email design system

**Audited:** 25 August 2026  
**Source archive:** owner-provided `Shopface Design System.zip` from the Dropbox folder supplied for this task.  
**Reference revision:** archive contents audited locally on 25 August 2026; canonical Astro source inspected read-only at `Dean-Rough/shopface` commit `fea6a90`.

## Scope and provenance

This document records only material verified in the Dropbox archive. It is a durable implementation brief for the canonical outreach renderer; it is not a claim that this Next.js/Convex storefront contains or owns that renderer.

The archive contains CSS design tokens, guidelines, React reference components, SVG assets and a PNG brand board. It contains **no** `.woff`, `.woff2`, `.ttf` or `.otf` font files, no email-specific HTML renderer and no sending integration.

The verified font source is `tokens/fonts.css`, which imports Google Fonts for:

- `Archivo` variable italic/width/weight (`75..125` width and `100..900` weight)
- `IBM Plex Mono` weights `400`, `500` and `600`

No local font binary, provider key, tracking pixel, form or delivery automation may be inferred from this archive.

## Approved asset inventory

`assets/` contains the following outlined SVG assets:

- Marks: `shopface-mark.svg`, `shopface-mark-lime.svg`, `shopface-mark-stone.svg`, `shopface-mark-charcoal.svg`
- Lowercase wordmarks: `shopface-wordmark.svg`, `shopface-wordmark-lime.svg`, `shopface-wordmark-stone.svg`, `shopface-wordmark-charcoal.svg`, `shopface-wordmark-source.svg`
- Uppercase wordmarks: `shopface-wordmark-upper.svg`, `shopface-wordmark-upper-lime.svg`, `shopface-wordmark-upper-stone.svg`, `shopface-wordmark-upper-charcoal.svg`
- Lowercase lockups: `shopface-lockup.svg`, `shopface-lockup-lime.svg`, `shopface-lockup-stone.svg`, `shopface-lockup-charcoal.svg`, `shopface-lockup-duo.svg`, `shopface-lockup-duo-dark.svg`
- Uppercase lockups: `shopface-lockup-upper.svg`, `shopface-lockup-upper-lime.svg`, `shopface-lockup-upper-stone.svg`, `shopface-lockup-upper-charcoal.svg`, `shopface-lockup-upper-duo.svg`, `shopface-lockup-upper-duo-dark.svg`

The archive README identifies `shopface-lockup-duo.svg` as the canonical lockup: lime mark with stone wordmark. `shopface-lockup-duo-dark.svg` changes the wordmark to charcoal for light surfaces. `shopface-wordmark-source.svg` is reference-only because it contains live text without an embedded font.

For email, do not assume remote SVG image support. The current canonical email renderer is deliberately image-independent, so use the brand name as styled text until a reviewed CID/hosted-image policy is supplied. Do not redraw or approximate the mark.

## Verified system tokens

### Palette

| Token | Value | Verified use |
| --- | --- | --- |
| `--sf-charcoal` | `#0D0F12` | Dark default background and lime ink |
| `--sf-charcoal-1` | `#14171C` | Raised dark surface |
| `--sf-charcoal-2` | `#1B1F26` | Raised dark surface step |
| `--sf-charcoal-3` | `#232830` | Dark surface step |
| `--sf-slate` | `#2C3340` | Supporting/border tone |
| `--sf-slate-1` | `#3A4252` | Supporting step |
| `--sf-slate-2` | `#4C5567` | Supporting step |
| `--sf-stone` | `#F2F2EA` | Default dark-surface text; light-scope paper |
| `--sf-stone-1` | `#E4E4D9` | Stone step |
| `--sf-stone-2` | `#C9C9BC` | Stone step and safe opaque email border |
| `--sf-stone-3` | `#9A9A8D` | Stone step |
| `--sf-sea` | `#4C6A8A` | Support tone |
| `--sf-sea-1` | `#628099` | Support step |
| `--sf-sea-deep` | `#33495F` | Support step |
| `--sf-lime` | `#C6FF3D` | One accent/action per view |
| `--sf-lime-bright` | `#D6FF6E` | Hover only |
| `--sf-lime-deep` | `#A6DF1C` | Press only |

The canonical CSS dark scope is charcoal/stone/lime. The `.sf-light` scope uses Stone `#F2F2EA` as its page, white `#FFFFFF` as its surface, Charcoal `#0D0F12` as text and a dark hairline. The archive README explicitly assigns this paper scope to “an emailed document.”

### Typography

- **Human/readable copy:** Archivo, default width `100`, with display at weight `500`, tracking `-0.045em` and line-height `0.94`.
- **Machine/asserted metadata:** IBM Plex Mono, including safety labels, operational labels, sector codes and times.
- **Scale:** `11`, `12`, `13`, `15`, `17`, `21`, `28` px; display `clamp(1.9rem, 3.4vw, 2.75rem)` through `clamp(3.6rem, 11vw, 8.5rem)`.
- **Tracking:** display `-0.045em`, tight `-0.02em`, label `0.12em`, mono `0.02em`.
- **Leading:** tight `0.94`, snug `1.12`, normal `1.5`, relaxed `1.65`.

### Spacing and layout

- Scale: `4`, `8`, `12`, `16`, `24`, `32`, `48`, `64`, `96`, `128` px.
- Web container: `1440px`; reading measure: `38rem`; fluid gutter: `clamp(1rem, 4vw, 3rem)`; vertical section rhythm: `clamp(5rem, 10vw, 9rem)`.
- Minimum interactive control height: `44px`.
- Radius values: `4`, `8`, `12.8`, `16`, `24` px, plus pill and circle. Hairlines and surface tint are preferred to shadow.

## Email-safe implementation rules

These rules preserve verified design intent using patterns broadly safe for email HTML; they do not claim that every modern CSS feature is supported by every client.

1. Render emails as nested presentation tables with attributes (`role="presentation"`, `width`, `cellpadding`, `cellspacing`, `border`) plus inline CSS. Preserve the existing image-independent HTML, plain-text alternative, HTTPS checks, escaping and `sendable: false` boundary.
2. Use the verified light/paper scope for the message: Stone page, white panel, Charcoal text, Stone-2 border, lime action with Charcoal ink. Use opaque hex values rather than CSS variables or alpha values in the rendered payload.
3. Use an email-safe font stack with `Archivo` first and Arial/Helvetica/sans-serif fallback. Use `IBM Plex Mono`, Monaco/monospace only for short metadata and safety labels. Do not add web-font fetches to delivery HTML.
4. Keep one lime primary action per view. Do not use gradients, large lime reading surfaces, or more than one visually competing lime control.
5. Make review status explicit and inert. The approved safety vocabulary is “Unofficial concept preview”, “Private”, “Unindexed”, an expiry state and “Human reviewed”; only render values already provided by the existing immutable review/snapshot model. Do not invent dates, claims or state.
6. No forms, scripts, trackers, remote pixels, automatic sends or provider SDKs. A future approved delivery adapter must remain server-only and use the platform `/site/notify` proxy with a supported event type; this task does not activate it.

## House typography and balanced-rag rule

**House prerequisite:** every copy surface must use intentional measures before it is approved. Never alter approved facts, inject viewport-specific `<br>` elements or use spacing characters to force a wrap.

- In web review surfaces, apply `text-wrap: balance` to headings and subject-like title lines, and `text-wrap: pretty` to body copy where supported.
- In delivery HTML, treat `text-wrap` as progressive enhancement only. The durable fallback is a constrained text cell: a 600px desktop shell, 42px side padding (approximately 516px readable width) and a mobile 24px padding override (approximately 327px at a 375px viewport).
- Keep subject-like headings in a deliberate measure: `max-width: 18ch` to `24ch` for the large email heading; never let a heading run across the full shell. Keep body paragraphs at the 15–16px, 1.5–1.65 leading rhythm.
- Validate the exact rendered HTML at 600px and 375px/narrow-inbox widths. Review title/heading last lines for a one-word orphan or a markedly uneven final line; fix the available measure or typography, not the approved wording.
- Plain-text alternatives retain factual copy and link destinations; line wrapping may be client-controlled and must never be modified by adding semantic-breaking punctuation or manual line breaks.

## Canonical renderer boundary (verified 25 August 2026)

The renderer required by this task is not present in this repository. The read-only canonical Astro repository has these locations:

- `packages/email/src/index.ts` — `renderFirstTouchEmail` and `renderIdentityReplyEmail`
- `packages/email/test/first-touch.test.ts` and `packages/email/test/identity-reply.test.ts` — renderer safety tests
- `apps/site/src/brand/shopface-brand.ts` — email-safe opaque brand tokens and contrast checks
- `apps/site/src/components/EmailReviewShell.astro` — wide/narrow internal review frame
- `apps/site/src/pages/internal/email-preview/first-touch/index.astro`
- `apps/site/src/pages/internal/email-preview/identity-reply/index.astro`

`/home/user/project` is the separate MadeThis Next.js/Convex storefront repository. It has no `.astro` files, no `packages/email` package and no outreach renderer/template to modify. Do not duplicate the renderer here; assign the canonical repository as the workspace before applying the implementation rules above.
