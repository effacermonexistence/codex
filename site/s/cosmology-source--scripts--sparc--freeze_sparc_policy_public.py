#!/usr/bin/env python3
"""Freeze the shared SPARC policy from a completed public dev-grid reproduction."""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path

def sha(path: Path) -> str: return hashlib.sha256(path.read_bytes()).hexdigest()
def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument('--dev',type=Path,required=True)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    a=ap.parse_args(); dev=json.loads(a.dev.read_text())
    out={
      'schema_version':'sparc-public-reproduction-frozen-policy-v1',
      'status':'FROZEN_FOR_PUBLIC_REPRODUCTION',
      'proof_status':'REPRODUCTION_ONLY_NOT_A_NEW_PROOF_RUN',
      'formula':dev['formula'],
      'kernel':'normalized 3D Plummer',
      'operator_object':'halo-only 3D density',
      'selection_objective':dev['objective'],
      'safe_optimum':dev['safe_optimum'],
      'forced_nonzero_optimum':dev['forced_nonzero_optimum'],
      'generic_control_rule':'half-mass-matched 3D Gaussian and top-hat with the same f/eta',
      'dev_artifact_sha256':sha(a.dev),
      'sample_manifest_sha256':sha(a.manifest),
    }
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
if __name__=='__main__': main()
