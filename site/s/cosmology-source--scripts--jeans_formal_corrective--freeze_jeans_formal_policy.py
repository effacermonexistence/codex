#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json
from datetime import datetime, timezone
from pathlib import Path

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument('--dev',type=Path,required=True)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    dev=json.loads(args.dev.read_text())
    manifest=json.loads(args.manifest.read_text())
    if dev.get('corrective_evaluation_scores_accessed') is not False:
        raise RuntimeError('evaluation score blindness violated')
    out={
      'schema_version':'jeans-formal-source-corrective-frozen-policy-v1',
      'status':'FROZEN_BEFORE_CORRECTIVE_EVALUATION_SCORING',
      'timestamp_utc':datetime.now(timezone.utc).isoformat(),
      'sample_manifest_sha256':sha(args.manifest),
      'dev_optimization_sha256':sha(args.dev),
      'development_names':manifest['development'],
      'evaluation_names':manifest['heldout'],
      'safe_optimum':dev['safe_optimum'],
      'direct_nonzero_optimum':dev['direct_nonzero_optimum'],
      'formula':dev['formula'],
      'response_projection_used':False,
      'no_evaluation_parameter_update':True,
      'no_evaluation_row_fallback':True,
      'no_evaluation_subset_exclusion':True,
      'proof_boundary':'Corrective post-exposure execution of a pre-existing direct formal-source family; not fresh/unseen proof.',
    }
    args.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')

if __name__=='__main__': main()
