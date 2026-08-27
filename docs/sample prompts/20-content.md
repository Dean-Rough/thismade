# Mux hero and glass navigation

Updated the marketing storefront on 25 August 2026.

- The homepage hero uses the supplied Mux HLS stream through a client-only component. Safari uses native HLS; browsers without native HLS dynamically load `hls.js`.
- Video stays muted, looping and inline. It does not start when reduced motion or the browser Save-Data preference is set, and the local greenhouse image remains the accessible visual fallback and video poster.
- The marketing header is now a floating dark glass bar with a restrained blur, saturation, highlight border and layered shadow. Browsers without backdrop-filter and people who prefer reduced transparency receive a solid dark bar instead.
- No offer, checkout, conversion-handoff, form, email, or footer-badge behavior changed.
