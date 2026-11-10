// A reviewed translation is authoritative for its exact source/locale only.
// Raw batch reimports must not silently undo a source-grounded semantic repair.
import fs from 'node:fs';
import path from 'node:path';
export function reviewedEntryIssues(catalog,dictionaries,review) {
  const issues=[];
  if(review.schemaVersion!==1||review.sourceCatalogHash!==catalog.sourceCatalogHash)return['reviewed translation provenance mismatch'];
  if(!Array.isArray(review.reviewedEntries)||!review.reviewedEntries.length)return['reviewed translation ledger is empty'];
  const ids=new Set(catalog.segments.map(x=>x.id)),seen=new Set();
  for(const row of review.reviewedEntries){
    const key=row.locale+'/'+row.id;
    if(seen.has(key))issues.push('duplicate reviewed translation '+key);seen.add(key);
    if(!ids.has(row.id)||!dictionaries.has(row.locale))issues.push('unknown reviewed source/locale '+key);
    else if(typeof row.value!=='string'||!row.value.trim()||!row.reason)issues.push('incomplete reviewed translation '+key);
    else if(dictionaries.get(row.locale).entries[row.id]!==row.value)issues.push('reviewed translation changed or stale candidate reimported '+key);
  }
  return issues;
}
export function checkReviewedEntries(root,catalog,locales) {
 const review=JSON.parse(fs.readFileSync(path.join(root,'content/i18n/reviewed-entries.json'),'utf8'));
 const allowed=new Set(locales.map(x=>x.code));const dictionaries=new Map();
 for(const row of review.reviewedEntries||[])if(allowed.has(row.locale)&&!dictionaries.has(row.locale))dictionaries.set(row.locale,JSON.parse(fs.readFileSync(path.join(root,'content/i18n/locales',row.locale+'.json'),'utf8')));
 return reviewedEntryIssues(catalog,dictionaries,review);
}
