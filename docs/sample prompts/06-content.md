# shopface design-system audit

**Reviewed:** 25 August 2026  
**Sources:** `Dean-Rough/shopface` `main` at `b824ea6` (read-only clone), its `Shopface Design System/` directory, and the approved brand-kit board supplied at `https://madethis.com/files/d68f0d4f-eda2-4e57-a44c-0b81534b32d1`.  
**Scope:** documentation only. No shopface application, deployment, credentials, GitHub settings, or brand assets were changed.

## Where the system lives

| Layer | Location | Current role |
| --- | --- | --- |
| Canonical-looking kit | `Shopface Design System/` | Standalone CSS tokens, visual guidelines, SVG marks and 17 React reference components; not a package or build input. `github.md` calls it a rebuilt UI kit/reference. |
| Marketing runtime | `apps/site/src/styles/marketing.css`, `apps/site/src/pages/index.astro` | Active public marketing styling; imports only its local CSS. |
| Preview runtime | `apps/site/src/styles/venue-preview.css`, `apps/site/src/pages/preview/[venue]/index.astro` | Active venue-preview styling and safety presentation. |
| Typed/email foundation | `apps/site/src/brand/shopface-brand.ts`, `apps/site/src/components/EmailReviewShell.astro` | Centralized hex tokens and contrast assertion for web/email payloads, but it does not feed the two runtime CSS files. |
| Brand assets | `Shopface Design System/assets/`; runtime has only `apps/site/public/brand/shopface-wordmark.svg` and `favicon.svg` | The full lime mark/lockups exist only in the reference kit; runtime uses an interim wordmark and an orange favicon. |

There is no import of the kit's `tokens/*.css` or `components/*.jsx` from `apps/site`. The repository therefore has a documented/reference system and independently implemented live styles, rather than one shared runtime design system.

## Reference-kit contract

- **Colour:** dark default semantic aliases: charcoal `#0D0F12`, lime `#C6FF3D`, slate `#2C3340`, stone `#F2F2EA`, and sea `#4C6A8A`; lime hover/press variants; dark-surface border/text aliases; local `.sf-light` paper scope. It also defines caution/critical status additions.
- **Type:** `Archivo` for display and UI plus `IBM Plex Mono` for operational labels; 11–21px body scale, fluid display scale from `clamp(1.9rem, 3.4vw, 2.75rem)` to `clamp(3.6rem, 11vw, 8.5rem)`, tight display tracking and mono/all-caps label tracking.
- **Layout:** 4px/8px-derived spacing scale, `1440px` container, `38rem` prose measure, fluid `clamp(1rem, 4vw, 3rem)` gutter, fluid `clamp(5rem, 10vw, 9rem)` section spacing, and a 44px minimum control height. Radius scale deliberately includes squared small surfaces and pill/circle controls.
- **Elevation/motion:** hairline/tinted surfaces are preferred over shadow; shadows reserved for floating UI. One non-bouncy easing curve, 140/300/450ms durations, `-2px` hover lift and slight press scale.
- **Components:** core `Logo`, `Button`, `Chip`, `Icon`, `SectionBadge`, `StatusPill`, `TextLink`; product `ConceptBar`, `FrontageScene`, `HoursList`, `ListingCard`, `StepList`; surfaces `BrowserFrame`, `Card`, `PreviewCard`, `PriceCard`, `Terminal`. The reference components use inline styles and CSS variables, not production-ready Astro components.
- **Responsive/accessibility conventions:** fluid tokens and component sizing; base CSS uses `:focus-visible`, selection colors, image constraints and reduced-motion override. The kit requires the minimum control height, text balance/pretty wrapping, and supports preview states such as private, unindexed and expiry.

## How the live site applies it today

- The marketing shell separately recreates the same container (`1440px`), fluid gutter, section spacing, pill controls and responsive grid progression at `480px`, `720px`, `920px` and `1200px`. It has skip links, visible focus rings and a reduced-motion override.
- The venue preview has an independent editorial system: paper/cream/sage/charcoal/orange palette; Iowan/Palatino-style display serif plus Avenir/Helvetica sans; its own responsive thresholds at `48rem`, `60rem` and `68rem`; sticky concept bar, skip link, focus ring and reduced-motion override.
- The typed brand module is dark/lime/stone/slate and validates every defined web/email text pair at a 4.5:1 minimum. Its values are used by email rendering, tests and metadata/wordmark consumers, not as CSS tokens for the public pages.
- Existing tests cover brand-token contrast, marketing shell structure/responsiveness and preview safety. They do **not** establish that the live CSS consumes the reference-kit tokens or components.

## Approved brand-kit comparison

The approved board is dark, technical and direct: lime `#C6FF3D` is primary, with charcoal/slate/stone/sea support; Space Grotesk is the primary typeface and IBM Plex Mono is secondary. It specifies the lime “S” mark and lockup, a grid/engineering language, restrained technical UI, high-contrast imagery and explicit private/unindexed/expiry/human-review cues.

| Finding | Evidence | Implementation implication |
| --- | --- | --- |
| **Live colour mismatch** | Both runtime CSS files retain orange `#F26522`; marketing is white/grey and previews are paper/cream/sage. The approved board is dark/lime, and the kit's semantic default is charcoal/lime. | Do not treat `marketing.css` or `venue-preview.css` as compliant with the approved board without a deliberate migration. |
| **Live typography mismatch** | Marketing is system sans; previews use Iowan/Palatino + Avenir/Helvetica. The kit changed to Archivo, while the approved board visibly specifies **Space Grotesk** + IBM Plex Mono. | Typography authority is ambiguous between the reference kit and the newer approved board; use the board as source of truth until this is resolved. |
| **Logo mismatch/ambiguity** | The approved board and reference assets contain the lime mark + lockup. Runtime brand documentation calls its charcoal system-sans wordmark “interim”; the app does not ship the mark/lockups and `favicon.svg` is orange. | Runtime logo/app-icon provenance is not aligned with the approved board; do not infer that the interim asset is an approved substitute. |
| **System integration gap** | `github.md` explicitly describes the kit as upstream/reference; no runtime import reaches its token or component files. | The named components and tokens cannot be relied on to change the rendered marketing site today. |
| **Safety-language alignment is partial** | Reference kit and approved board both show the private/unindexed/expiry/review model; live previews implement a sticky “unofficial concept” bar and safety tests. | Keep the existing preview-safety checks authoritative; the visual safety-state component is not presently used. |
| **Visual-world mismatch** | The board calls for dark technical fields, disciplined grid cues and Scottish landscape imagery. The live marketing hero uses bright abstract orange/grey shader effects; previews use warm editorial illustration. | These are concrete divergent treatments, not evidence of a shared deployed visual system. |

## Verified checks

- Public source was cloned read-only at the commit above.
- No existing check was run in that clone because its dependencies were not installed and installing them would mutate the cloned working tree. The repository CI check is `pnpm check` after `pnpm install --frozen-lockfile`.
- The current repository's `npm run build` and `npx tsc --noEmit` both passed after this documentation-only change. Next.js emitted existing Edge Runtime compatibility warnings from `jose` during the build.
