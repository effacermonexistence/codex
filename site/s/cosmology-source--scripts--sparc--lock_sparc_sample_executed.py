#!/usr/bin/env python3
from __future__ import annotations
import argparse,json
from pathlib import Path
from sparc_adapter_common import canonical_sha,eligible_names,load_catalog,load_r2_hasher,sha256_file

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--catalog',type=Path,required=True); ap.add_argument('--zip',type=Path,required=True); ap.add_argument('--r2-root',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); a=ap.parse_args()
 catalog=load_catalog(a.catalog); eligible=eligible_names(catalog,a.zip)
 if len(eligible)!=21: raise RuntimeError(f'expected 21 locked eligible galaxies, got {len(eligible)}')
 dev=eligible[:14]; heldout=eligible[14:]
 if 'NGC3109' not in dev: raise RuntimeError('prior-seen NGC3109 must remain in dev')
 r2_path,hasher=load_r2_hasher(a.r2_root); ids=[f'SPARC:{x}' for x in eligible]; inp={'sample_ids':ids}; input_sha=canonical_sha(inp); sample_hash=hasher(ids); output_sha=canonical_sha({'sample_ids_sha256':sample_hash})
 out={'schema_version':'sparc-equation-adapter-sample-lock-v1','status':'LOCKED_BEFORE_SCIENTIFIC_SCORING','eligibility':{'quality':1,'hubble_type_min':7,'inclination_deg':[30,85],'bulgeless':True,'min_rotation_rows':12,'rdisk_positive':True},'split_rule':'eligible galaxies sorted by SHA256(galaxy); first 14 dev, remaining 7 heldout','prior_visibility':{'NGC3109':'prior score visible; forced into dev by predeclared hash split','heldout_prior_score_visibility':False},'eligible':eligible,'dev':dev,'heldout':heldout,'catalog_rows':{n:catalog[n] for n in eligible},'source':{'catalog_sha256':sha256_file(a.catalog),'rotmod_zip_sha256':sha256_file(a.zip)},'r2_invocation':{'source_path':str(r2_path),'callable':'sample_ids_sha256','arm':'manifest','call_site':'lock_sparc_sample.py:main','input_sha256':input_sha,'output_sha256':output_sha,'outcome':'eligible/dev/heldout sample identities locked before scientific scoring'},'sample_ids_sha256':sample_hash}
 a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
if __name__=='__main__': main()
