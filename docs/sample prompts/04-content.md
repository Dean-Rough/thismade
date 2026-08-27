# MadeThis frontend adoption audit

**Reviewed:** 25 August 2026  
**Source inspected:** `Dean-Rough/shopface` `main` at `b0d90bd1d6c09cdc50cc62a0815adf8b7f173061` (read-only clone).  
**Brand authority:** approved board at `https://madethis.com/files/d68f0d4f-eda2-4e57-a44c-0b81534b32d1`, verified against the identical checked-in board asset (`SHA-256` `7a5a496773e3f5b867bf608a23f82785968a46dd84f41d55d5532f7f7e44ae00`).  
**Decision:** **Yes — MadeThis can become the public marketing surface, but only as a marketing-shell migration.** The Astro/Vercel application must remain canonical for preview generation, preview serving, immutable content, review evidence, expiry/teardown, email-review rendering, and the control plane.

## What MadeThis can reuse

| Reusable layer | Exact source paths | Adoption guidance |
| --- | --- | --- |
| Semantic tokens | `Shopface Design System/tokens/colors.css`, `Shopface Design System/tokens/fonts.css`, `Shopface Design System/tokens/typography.css`, `Shopface Design System/tokens/spacing.css`, `Shopface Design System/tokens/radius.css`, `Shopface Design System/tokens/elevation.css`, `Shopface Design System/tokens/motion.css`, `Shopface Design System/tokens/base.css` | Port semantic intent to the MadeThis storefront tokens, not raw values scattered through components. The dark default, lime primary, stone text, slate/sea support, 4/8px spacing, 44px controls, restrained elevation, and reduced-motion treatment are suitable as-is. |
| Type system | `Shopface Design System/tokens/fonts.css`, `Shopface Design System/tokens/typography.css` | The kit ships Archivo + IBM Plex Mono. The approved board specifies **Space Grotesk + IBM Plex Mono**. For a MadeThis public build, follow the board: Space Grotesk display/body and IBM Plex Mono operational labels. Do not treat the kit's Archivo substitution as an authority override. |
| Core UI patterns | `Shopface Design System/components/core/{Logo,Button,Chip,Icon,SectionBadge,StatusPill,TextLink}.jsx` | Rebuild as native MadeThis/Next components with semantic tokens; the current JSX references are visual contracts, not production package exports. |
| Marketing compositions | `Shopface Design System/ui_kits/marketing/{Nav,Hero,Process,Work,Pricing,Contact,MarketingApp}.jsx` | Reuse the asymmetric hero, step rail, terminal/browser diptych, proof/status labels, preview gallery, price comparison, and final CTA. Preserve the supplied content and safety language rather than inventing a new campaign. |
| Product visual vocabulary | `Shopface Design System/components/product/{ConceptBar,FrontageScene,HoursList,ListingCard,StepList}.jsx`, `components/surfaces/{BrowserFrame,Card,PreviewCard,PriceCard,Terminal}.jsx` | Reuse only for non-live demonstrations and static marketing illustrations. Product preview rendering remains in Astro. |
| Approved mark assets | Platform canonical URLs supplied for the storefront: `https://grandiose-goshawk-617.convex.cloud/api/storage/068a023e-1f74-4d9a-8fb0-a28575784779` (light/default) and `https://grandiose-goshawk-617.convex.cloud/api/storage/a4dad6d4-03e3-4674-b536-74947304ffc3` (dark). Source reference variants also exist in `Shopface Design System/assets/`. | Use the supplied platform URLs verbatim via `NEXT_PUBLIC_BRAND_LOGO`, `NEXT_PUBLIC_BRAND_LOGO_LIGHT_MODE`, and `NEXT_PUBLIC_BRAND_LOGO_DARK_MODE` (or embed those exact URLs if env values are unavailable). Preserve proportions with one dimension set to `auto`; do not redraw or substitute the mark. |

## Brand alignment and copy authority

The approved board is a dark technical system: charcoal `#0D0F12`, lime `#C6FF3D`, stone `#F2F2EA`, slate `#2C3340`, sea `#4C6A8A`; square-grid construction; high-contrast Scottish landscape imagery; direct, compact wording; and explicit **Private / Unindexed / Auto-expires / Human reviewed** status cues. The reference kit substantially matches this palette, visual hierarchy, technical UI language, spacing, and safety indicators.

Two implementation corrections are required for MadeThis adoption:

1. The live Astro public CSS in `apps/site/src/styles/marketing.css` still uses the prior light/editorial orange treatment. Do not copy that palette into MadeThis; use the approved dark/lime world and the reference-kit system where they align.
2. The reference-kit font file chooses Archivo, while the approved board names Space Grotesk. The board wins. Keep IBM Plex Mono for preview/status metadata.

The current public landing in `apps/site/src/pages/index.astro` is the wording baseline. Retain its information architecture and its approved claims:

1. **Hero:** “We build the site first. Then you decide.” / “No speculative proposal deck. We make a working preview, check the facts, and send one link.”
2. **How it works:** build first, prospect decides, then care/maintenance; no claim of automatic or unreviewed outreach.
3. **Fictional previews:** explicitly say they are fictional and make no prospect-data or customer-result claim.
4. **Offer:** Website + Care, `£29/month` for the first ten customers (fixed for twelve months), `£39/month` thereafter, a three-month initial term, and `£25` one-page/30-minute content updates where applicable; larger changes quoted first. The canonical broader offer framing is in `.agent/founding-offer-copy.md` and `docs/brand/voice-and-positioning.md`.
5. **Contact:** keep the honest statement that the live enquiry route is not switched on until a real, reviewed intake path exists.

Do not promote the UI-kit phrase “auto-expires after fourteen days” as an immutable public promise unless the control-plane configuration makes that exact duration canonical. The product does enforce expiry safety, but duration belongs to the preview record/configuration.

## Ownership boundary

| Surface | Owner | Reason |
| --- | --- | --- |
| Public marketing homepage and static pricing/offer pages | MadeThis frontend | It is presentation/copy only and can consume the approved brand assets and fixed approved content without product access. |
| Public fictional-preview links | Astro/Vercel | Current links and fixture model live in `apps/site/src/pages/index.astro`, `apps/site/src/fixtures/registry.ts`, and `apps/site/src/pages/preview/[venue]/index.astro`; MadeThis may link to them, not re-render or proxy them. |
| Prospect-specific/private previews | Astro/Vercel | `apps/site/src/preview-safety.ts`, `apps/site/src/integrations/preview-safety-integration.ts`, and `apps/site/vercel.json` enforce concept labels, robots directives, no live forms, and build-time safety checks. |
| Content snapshots, presets, preview model and build receipts | Astro workspace/control plane | `packages/contracts/src/site-content.ts`, `packages/contracts/src/site-content-export.ts`, `apps/site/src/presets/sector-presets.ts`, `apps/site/src/venue-preview-model.ts`, and `apps/site/src/publish/` remain canonical product records and publishing logic. |
| Expiry and teardown | Astro control plane/database | `apps/control/src/preview-teardown-runtime.ts`, `apps/control/src/preview-teardown.ts`, and `packages/db/src/` must retain ownership. A storefront cannot substitute link hiding for actual preview removal. |
| Internal email preview/review | Astro | `apps/site/src/components/EmailReviewShell.astro` and `apps/site/src/pages/internal/email-preview/` remain review surfaces; they are not public marketing content. |

## Smallest safe migration slice

1. Recreate **only `/`** in the MadeThis frontend as a static, dark/lime Shopface marketing page using the approved logo URLs, board type choices, and the approved landing-page sections: nav, hero, process, fictional-preview gallery, pricing, and an honest disabled/no-intake closing CTA.
2. Keep each gallery CTA as a normal absolute link to the existing Astro fictional preview URL. Do not import Astro fixtures, preview data, private tokens, or control-plane APIs into the storefront.
3. Leave the existing Astro homepage deployed during the first review period. Switch the public marketing domain only after content/design review, link checks, and a rollback target are agreed; the Astro preview host/route stays unchanged.
4. Do not move pricing into a second checkout system. If/when a compliant MadeThis checkout is configured, use the platform's SaaS subscription flow and preserve the defined monthly/term semantics. Do not add Stripe packages, keys, or a parallel checkout.

## Page mapping

| Current shopface route/surface | MadeThis action | Destination/notes |
| --- | --- | --- |
| `apps/site/src/pages/index.astro` (`/`) | Migrate first | MadeThis public `/`; static approved marketing shell only. |
| `apps/site/src/pages/preview/[venue]/index.astro` (`/preview/:token/`) | Keep | Astro/Vercel canonical preview product; link from MadeThis where public fictional examples are intended. |
| `apps/site/src/pages/internal/dark-hero-compare.astro` | Keep internal | Design comparison/review, not a public route to reproduce. |
| `apps/site/src/pages/internal/email-preview/**` | Keep internal | Email review and evidence remain in Astro. |
| `apps/control/**`, `packages/contracts/**`, `packages/db/**`, `packages/email/**` | Keep | Control plane, schemas, lifecycle, evidence, and reviewed email payloads remain product infrastructure. |
| MadeThis generic `/pricing`, `/about`, `/blog`, auth/app/admin routes | Do not migrate now | They are template surfaces, not established shopface public IA; avoid duplicate claims, accounts, dashboards, or product controls during the pilot. |

## Dependencies and risks

- **Design-system packaging:** the kit is currently a reference directory, not an importable runtime package; port it deliberately into MadeThis components and retain a source-to-component mapping instead of attempting a cross-runtime import.
- **Content drift:** `Shopface Design System/ui_kits/marketing/` contains useful updated compositions but differs from the public Astro wording/counts. `apps/site/src/pages/index.astro` plus the cited brand/offer documents are the claim authority; resolve discrepancies in review before publishing.
- **Brand assets:** use only the approved platform logo URLs for the MadeThis storefront. The source repo's SVG variants are references, not permission to substitute or reconstruct a logo.
- **Canonical links:** keep a single redirect/domain strategy so a marketing-domain change does not break preview links, robots policies, sitemap intent, or analytics attribution.
- **Safety:** never expose preview creation, source facts, private tokens, snapshots, deletion, or internal review routes through the storefront. Preview safety remains verified on Astro's real build path.
- **Email:** if a future MadeThis marketing intake needs notification, the server route/action must call the platform's absolute `/site/notify` proxy with raw-body HMAC signing and a supported type such as `contact_inquiry`; use no third-party email SDK, provider, or key. Do not add a live form before that server-only flow and the required review/privacy decisions exist.

## Recommendation

Adopt the MadeThis frontend as the public **marketing** layer, beginning with the one static homepage. Keep Astro/Vercel as the sole preview and control-plane product. This gains the approved dark technical/lime brand presentation without weakening the existing private-preview, unindexed, no-form, human-review, immutable-content, and expiry/teardown guarantees.
