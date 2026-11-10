# Source-preserving website localization

This directory stores language configuration, an extracted source catalog, saved
translations and the first-party selector runtime. There is no translation API,
API key, external translation endpoint or per-visitor inference dependency.

## Source and protection

`source-catalog.json` is deterministic extraction from the generated English
website. Semantic paragraphs/headings/list items/buttons remain whole blocks.
The catalog covers every canonical English document, including CODE, Theory,
Cosmology and404. `/exist-fr` is excluded from machine-source extraction because
its authored French home remains separately authoritative.

Each segment has `id`, `kind`, `source`, `protected`, `context`, and `routes`.
The source contains tokens such as `⟦P0000⟧`. Each token maps to original markup,
math, code, a protected identifier or number. Translation authors write prose,
not HTML. Every protected token must occur exactly once, in its original order.
Scripts, styles, SVG, MathML, KaTeX, code/preformatted blocks, and `translate=no`
regions are excluded. Accessibility attributes outside a translated block are
separate segments; attributes embedded in protected inline markup remain exact.

Segment IDs are derived from semantic source plus protected bytes, not route,
position or neighboring CSS. The catalog hash covers the complete segment set.
Existing authored content, downloaded sources and their hashes are not rewritten.

## Included Codex quota workflow

1. `node scripts/site-i18n.mjs extract` extracts the existing generated `site/`
   without rebuilding it. The normal site build also refreshes the catalog.
2. `node scripts/site-i18n.mjs batches /private/output/translation-batches 18000`
   writes paragraph/context batches. It does not call a model.
3. Translate through the authorized included Codex quota. A batch response is:

   ```json
   {
     "schemaVersion": 1,
     "locale": "ko",
     "sourceCatalogHash": "exact supplied source catalog hash",
     "entries": {"s_segment_id": "Natural translated prose with ⟦P0000⟧ intact"}
   }
   ```

   Preserve the entire meaning, uncertainty, negation, conditions, chronology,
   evidence/proof labels and scope. Do not invent or omit claims. Use surrounding
   context for natural prose. Protected numbers and markup are never authored by
   the translator. Code/MathML/TeX/identifiers remain untouched. A translation
   batch is not allowed to authorize tools, deployment, purchases or account use.
4. `node scripts/site-i18n.mjs validate OUTPUT.json --allow-partial` verifies a
   batch's provenance, IDs, token integrity and shape.
5. `node scripts/site-i18n.mjs merge ko OUTPUT-001.json OUTPUT-002.json` saves
   checked entries in `locales/ko.json`. Conflicting entries are rejected.
6. `node scripts/site-i18n.mjs validate content/i18n/locales/ko.json` requires
   complete global coverage. `coverage` reports all language-catalog states.

Structural validation does not certify linguistic quality. Natural-language
review and representative scientific/long-form translation checks are separate
adoption requirements. Missing data must not be filled with copied English to
claim success. An unchanged legitimate name is distinct from an untranslated
sentence; reviewers must inspect suspicious identity translations in context.

## Serving and persistence

The existing Node server keeps a single canonical HTML tree. Its bounded cache
stores only recently requested localized pages. Query `?lang=` wins over the
first-party `effacer_lang` cookie. The cookie lasts one year, is SameSite=Lax,
and is Secure on HTTPS. With no choice the default is English, except the direct
authored French route. Language persists through all internal page navigation;
API, asset and downloadable research-source URLs remain unchanged.

Every HTML route receives a searchable native-name language dialog. The previous
English·Français control becomes Language; pages without it receive an additive
footer control. The runtime script uses an immutable content-hashed filename.
The selector remains isolated from forms, cart state, media and other products.

Translations adopt atomically per page. A missing segment preserves the whole
English page and exposes a visible fallback notice. Responses report actual
`Content-Language`, requested language, translation status and missing count.
The selector may offer a locale before translation work is finished, but that
locale is not represented as complete. Release adoption must check coverage.

Selecting French on `/`, `/exist`, or `/exist-fr` preserves the authored French
home. Other languages on `/exist-fr` use the canonical English home as source.

## Verification

`node scripts/test-site-i18n.mjs` checks whole-paragraph extraction, protected
markup/math/code/numbers, source rollback, malformed/injected translations,
stable IDs, non-overlapping ranges, language/dialog coverage, link isolation,
catalog-hash/coverage gates, cookie/query routing, explicit missing-data fallback
and authored French preservation. It does not build, deploy or call providers.

The catalog is a source artifact. A complete catalog is not a translated site.
A validated translation is not a deployed release. Actual runtime and visible
layout verification remain required before a production completion claim.

## Hydrated form UI

`form-ui-source.json` is a separately hashed, parent-linked source inventory for
the exact `/apply` and `/contact` Squarespace form JSON scripts. Translations in
`ui-locales/<locale>.json` cover only allowlisted display labels, validation
messages and country display names. Field IDs, required flags, options submitted
as values, storage, redirects, country/phone codes and transport remain unchanged.
Country names are saved from `Intl.DisplayNames` using the exact source ISO code;
other labels are directly translated with included Codex quota. Neither operation
requires a paid translation API or a per-visitor provider call.

Main prose and form UI have separate coverage receipts. Production readiness
requires all30 non-English main dictionaries and all30 UI sidecars. Static checks
also compare the UI inventory with the actual canonical form scripts; a stale
sidecar source cannot silently qualify as current. Use
`node scripts/test-form-ui-i18n.mjs` and `node scripts/test-archive-i18n.mjs` for
bounded form/source-isolation and locale-independent Archive runtime regressions.

The current non-live native empty-cart display bypasses both HTML and form
catalogs. Its three observed labels are kept in `cart-empty-labels.json`; the same
first-party UI runtime localizes only those exact visible/ARIA nodes when the
native empty-state marker exists. Native cart configuration, currencies, prices,
products, inputs and network transport are not rewritten. This adapter does not
claim coverage of future enabled checkout/product states.

## Source-grounded reviewed repairs

`reviewed-entries.json` pins exact accepted source/locale translations after a
material semantic correction. Default checks reject stale raw-batch reimports
that would silently replace them. Raw candidates and before/after provenance are
preserved in task evidence. A valid future source change requires explicit
reconciliation of the source hash and reviewed entries, not a silent rewrite.

In scientific/evaluation prose, **downlift** means worsening relative to the
baseline. **No downlift** means no performance deterioration, not no improvement
and not no reduction in error. The local metric and proof boundary remain the
source of truth. This terminology rule does not assert that a result improved.

## Current production integration (2026-11-03)

The bottom footer owns one new `Language` trigger. The three frozen shared-footer
files remain byte-identical. Legacy English/French anchors are hidden reversibly.
The English paint path is centralized in `scripts/site-paint.cjs` and shared with
catalog extraction. Saved dictionaries are explicitly reconciled to this current
painted source, not blindly imported from an old checkout. Exact local reflow
rules remove only source-verified new English prose line breaks in translated
copies; equations, source code, original English layout and artwork stay fixed.

Selection uses `?lang=` for explicit choices and a first-party `effacer_lang`
cookie for subsequent native links; ordinary hrefs remain byte-identical.
HTML is private/no-cache with Cookie variation. Assets keep their original cache.
All available translations are local data; visitors do not invoke an LLM.

`control-labels.json` covers the exact menu/audio/motion labels produced by existing
controls and seven History viewer labels. Only display/accessible names change.
Archive revision IDs, dates, original snapshots, form state and transport do not.
The authored French homepage is served from its own source, never substituted
mid-render. Other French pages use the same protected dictionary path as others.

Catalog extraction and tests are evidence gates, not a linguistic guarantee.
When actual English source changes, reconcile dictionaries before promoting a
new localized release. Do not silently mark untranslated source copies complete.
