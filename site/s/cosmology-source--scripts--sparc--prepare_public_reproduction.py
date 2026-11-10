#!/usr/bin/env python3
"""Verify public SPARC inputs and emit a local reproduction-only gate.

This is not the R2 proof gate used by the original run. It only prevents the
public reproduction commands from running against the wrong source bytes or a
drifted sample manifest.
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
from sparc_adapter_common import eligible_names, load_catalog, sha256_file

def sample_ids_sha256(names: list[str]) -> str:
    return hashlib.sha256("\n".join(f"SPARC:{name}" for name in names).encode()).hexdigest()

def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument('--catalog',type=Path,required=True)
    ap.add_argument('--zip',type=Path,required=True)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    a=ap.parse_args()
    manifest=json.loads(a.manifest.read_text())
    catalog=load_catalog(a.catalog)
    names=eligible_names(catalog,a.zip)
    checks={
      'catalog_sha256':sha256_file(a.catalog),
      'rotmod_zip_sha256':sha256_file(a.zip),
      'eligible_match':names==manifest['eligible'],
      'sample_ids_sha256':sample_ids_sha256(names),
    }
    ok=(checks['catalog_sha256']==manifest['source']['catalog_sha256'] and
        checks['rotmod_zip_sha256']==manifest['source']['rotmod_zip_sha256'] and
        checks['eligible_match'] and
        checks['sample_ids_sha256']==manifest['sample_ids_sha256'])
    out={
      'schema_version':'sparc-public-reproduction-input-gate-v1',
      'status':'PASS' if ok else 'FAIL',
      'phase':'post',
      'scope':'PUBLIC_REPRODUCTION_INPUT_INTEGRITY_ONLY',
      'r2_proof_gate':False,
      'checks':checks,
    }
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
    if not ok: raise SystemExit('public reproduction input gate failed')
if __name__=='__main__': main()
