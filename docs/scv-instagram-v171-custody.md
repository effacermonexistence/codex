# SCV Instagram v171 custody record (2026-09-12)

The production sealed descriptor and all 265 runtime inputs were acquired from the running service and verified against their hashes. The release includes the prior language matching and v171 voice-law implementation. This record does not certify unrestricted production audience or a new recovery Gold.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260912-v171` |
| content fingerprint | `af00b9c36513bb69a30a9f935ebadeb7909838dacfd89ab78da696aebabbc481` |
| release manifest sha256 | `5a82792babcffbb5968e967e1695447244618e94121b3c237c7aaa1d4a343d85` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260912T191000Z/v171/scv-instagram-single-20260912-v171-runtime.tar.gz` sha256 `1013c3693c0cf2a30383e010bf0c034097bf2414dab828f9aa7224656b7afcc6` (1569836 bytes, downloaded and byte/hash verified) |

## Executed verification

- R2 readback archive extracted into a separate private cold-restore directory
- All 265 sealed inputs and the recomputed fingerprint matched the production descriptor
- The restored language harness passed 257/257
- Production /readyz reported v171 with preflight verified and fail-close inactive at this capture
- Audience remains the existing code-locked debug target only
- Staging remains frozen and its stale-release alert is intentionally retained
- Gold pointers, recovery pins, ManyChat configuration and customer state were not changed

## Boundary

This is a runtime-code recovery package. It excludes credentials and mutable customer data. A runtime archive does not by itself prove full operating-server restoration. Pending reset-orphan and general-language changes remain separate work.
