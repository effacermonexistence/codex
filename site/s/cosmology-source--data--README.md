# External data

No third-party data files are committed. Download the source products described in [`docs/DATA_PROVENANCE.md`](../docs/DATA_PROVENANCE.md), verify their checksums, and pass local paths to the reproduction adapters.

For the SPARC lane, use `data/sparc/Rotmod_LTG.zip` and
`data/sparc/SPARC_Lelli2016c.mrt`; the exact commands and expected hashes are in
[`scripts/sparc/README.md`](../scripts/sparc/README.md).

For the dwarf-spheroidal Jeans lane, download the CDS/VizieR
`J/AJ/137/3100` `ReadMe` and `table2.dat` through `table5.dat`; commands and
expected hashes are in [`scripts/jeans/README.md`](../scripts/jeans/README.md).

The post-exposure direct formal-source Jeans run additionally uses the Spencer et al. (2018) CDS/VizieR
`J/AJ/156/257` Draco and Ursa Minor multi-epoch tables and McConnachie (2012)
`J/AJ/144/4` structural metadata. Exact source identifiers and hashes are in
[`docs/DATA_PROVENANCE.md`](../docs/DATA_PROVENANCE.md); raw catalogs are not
redistributed.

For the X-COP direct hydrostatic-equation lane, download the official profile
archive and verify SHA-256
`0edf5038b419b70d070b73b22f4801e27f318b0854db61eec52142c27c140d94`.
Exact commands are in
[`scripts/xcop_hse/README.md`](../scripts/xcop_hse/README.md).
