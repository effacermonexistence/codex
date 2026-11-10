# Shared Archive footer

All served current pages use one SSR footer from `scripts/site-shared-footer.cjs`.
The reference is the approved `/archive` footer: original struck PNG wordmark,
PT Serif, centered grey copyright, and the unchanged page-specific history link.

Source pages remain byte-identical. `content/site-footer/layout.json` identifies
only legacy footer blocks to omit and the trailing grid rows they occupied.
Header logos and all other main content must remain unchanged. The common
geometry in `content/site-footer/style.css` is independent of page-specific fonts
and grids. The renderer runs before the existing history footer renderer.

When adding or rebuilding a page, classify its legacy footer and grid boundary
before publishing. Never guess an image at the top of the page is a footer.
Run the whole route contract, responsive footer checks and non-footer content
comparison. Keep `/apply` controls, UCEQ diagram, artwork and media unchanged.

Rollback is the complete prior sealed release, not an unverified canonical root
checkout. The website history runbook and append-only backup gate still apply.
The footer date is the deployed release date in America/Los_Angeles.
