import assert from 'node:assert/strict';
import {reviewedEntryIssues} from './reviewed-i18n.mjs';
const catalog={sourceCatalogHash:'source',segments:[{id:'row'}]},maps=new Map([['fr',{entries:{row:'no performance degradation'}}]]),review={schemaVersion:1,sourceCatalogHash:'source',reviewedEntries:[{locale:'fr',id:'row',value:'no performance degradation',reason:'Source says no downlift, not no improvement'}]};
assert.deepEqual(reviewedEntryIssues(catalog,maps,review),[]);
assert.ok(reviewedEntryIssues(catalog,new Map([['fr',{entries:{row:'no improvement'}}]]),review).some(x=>x.includes('stale candidate')));
assert.ok(reviewedEntryIssues(catalog,maps,{...review,sourceCatalogHash:'other'}).length);
assert.ok(reviewedEntryIssues(catalog,maps,{...review,reviewedEntries:[...review.reviewedEntries,...review.reviewedEntries]}).some(x=>x.includes('duplicate')));
assert.ok(reviewedEntryIssues(catalog,maps,{...review,reviewedEntries:[{...review.reviewedEntries[0],id:'invented'}]}).some(x=>x.includes('unknown')));
console.log('PASS reviewed translation source/locale pins; stale reversal, wrong source, duplicate and unknown ID rejected; no provider calls');
