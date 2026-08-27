# Shopface marketing photography

Updated: 25 August 2026

## Intent

Three editorial photographs support the public marketing pages without presenting a real shopface customer, client result, or case study. They are locally committed JPEGs and framed with the existing dark technical palette, lime details, and overlays so the copy remains primary.

## Sources and licence

All sources were downloaded from Unsplash pages marked **Free to use under the Unsplash License**. The licence permits commercial use; attribution is not required by the licence, but source records are retained here.

| Local asset | Source | Creator | Placement |
| --- | --- | --- | --- |
| `public/images/marketing/greenhouse.jpg` | `https://unsplash.com/photos/greenhouse-filled-with-lush-green-plants-and-an-open-door-Y3E8Y14LiFg` | Matt Baker (`@himattbaker`) | Decorative background within the homepage’s fictional, clearly unofficial preview treatment. Empty alt because it does not convey page content. |
| `public/images/marketing/paper-workbench.jpg` | `https://unsplash.com/photos/cutting-red-patterned-paper-on-a-green-mat-hmMpaRspHNw` | Darien Attridge (`@dariendesigns`) | Pricing-page supporting editorial frame. Alt: paper, pencil and craft tools on a cutting mat. |
| `public/images/marketing/carpenter-workshop.jpg` | `https://unsplash.com/photos/a-man-smiles-as-he-works-on-a-piece-of-wood-PxlKOcj0a3Q` | Vatsal Tyagi (`@vatsaltyagi`) | About-page supporting editorial frame. Alt: a carpenter at a timber bench. |

The original downloads were requested with Unsplash’s image transformation parameters at approximately 2200px wide and quality 82. Next.js serves responsive optimized output from these local assets.

## Art direction and safety

- No photo is identified as a shopface client or used as proof of outcomes.
- No external image is hotlinked at runtime.
- Frames retain explicit dimensions through `next/image` `fill` containers and fixed aspect ratios to avoid layout shift.
- Photo overlays preserve contrast and keep calls to action separate from imagery.
- Prominent marketing headings use `text-wrap: balance` with tuned character measures rather than viewport-specific manual line breaks.
