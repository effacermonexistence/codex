# SCV Instagram v171 source custody (2026-09-12)

This records acquisition of the already-running release for OS1. It does not
deploy, reset, promote Gold, or enable customer traffic.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260912-v171` |
| content fingerprint | `af00b9c36513bb69a30a9f935ebadeb7909838dacfd89ab78da696aebabbc481` |
| release manifest sha256 | `5a82792babcffbb5968e967e1695447244618e94121b3c237c7aaa1d4a343d85` |
| runtime archive (R2) | `scv-instagram-automation/source-custody/3503712b4b057d318ea20b28a33f21d86365909a2a3b7dad754818f7d97fc9fd/source.tar.gz` sha256 `3503712b4b057d318ea20b28a33f21d86365909a2a3b7dad754818f7d97fc9fd` (1570876 bytes, readback byte-identical) |

The authenticated operator verified /readyz against the source manifest and all
265 manifest-listed files (size and SHA-256). The private archive contains only
those files plus SCV_SINGLE_RELEASE.json, not customer state or authentication
caches. R2 readback matched the local package byte-for-byte. OS1 source-register
independently accepted every member against the live manifest.

At acquisition /readyz reported production active, critical alerts 0,
operational alerts 2. Readiness is not customer-visible delivery confirmation.
The release's behavior-contract identity is Omar.system-only; this operation
does not change its audience, any pause settings, or ManyChat configuration.

The runtime sources stay private in the existing bucket. This public record
contains identifiers, hashes and retrieval metadata only. Current recovery
pointers, dated Gold records and historical baselines are unchanged.
