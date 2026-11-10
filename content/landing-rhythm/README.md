# First landing spacing reference

Only `/`, `/exist` and `/exist-fr` use this layer. Keep the first French brand image, its grid, native typography, background, content order and links intact. Move the existing title/Logic block upward by half the original visible brand-to-title gap. Move SEE MORE / VOIR PLUS upward by that amount plus one third of its original visible gap from Logic.

Measure native gaps by adding previously applied offsets back before each calculation. Resize, font/image readiness and pageshow must not repeatedly reduce an already corrected gap. Coalesce measurements into one animation frame; do not add polling or scroll handlers. The unmodified layout remains the fallback when JavaScript is unavailable.

The four main section entrances reuse the landing's existing full logo width and title/body sizes through `content/section-identity` and `content/site-typography`. Preserve the horizontal navigation, cropped editorial wordmark and frozen footer.
