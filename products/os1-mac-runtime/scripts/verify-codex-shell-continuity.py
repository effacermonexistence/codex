#!/usr/bin/env python3
"""Compare the actual OS1 transcript with its installed baseline, without model calls.

Unlike the older incident-specific tests, this does not assume a fixed number of
tables or receipts in a mutable user conversation. It never edits user state.
The native snapshot command deliberately caps raster height at 20,000 points;
full document content and off-viewport geometry are checked independently.
"""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
read = lambda name: json.loads((root / name).read_text())
baseline = read('baseline-900.png.layout.json')
context = read('baseline-900.png.context.json')
full_copy = (root / 'baseline-900.png.copy.txt').read_bytes()
math = read('baseline-900.png.math.json')
cell_identity = lambda cells: [(c['row'], c['column'], c['text']) for c in cells]
expected_cells = cell_identity(baseline['tableCells'])
checks = []

def check(name, predicate):
    checks.append({'name': name, 'status': 'PASS' if predicate else 'FAIL'})

def geometry_ok(layout):
    width = layout['widthPoints']
    return all(not p['intersects'] and p['gapPoints'] >= 12 for p in layout['pairs']) and all(
        f['paint']['x'] >= 0 and f['paint']['x'] + f['paint']['width'] <= width + 1
        for f in layout['frames'])

check('Baseline contains actual table and math source', bool(expected_cells) and bool(math))
check('Baseline full-raster cap already applies to this long transcript',
      max(f['paint']['y'] + f['paint']['height'] for f in baseline['frames']) > baseline['heightPoints'])
for width in (660, 900, 1100):
    for state in ('waiting', 'folded', 'receipts', 'expanded'):
        prefix = f'{width}-{state}.png'
        layout = read(prefix + '.layout.json')
        check(f'{width}/{state}: actual painted blocks do not intersect or overflow horizontally', geometry_ok(layout))
        check(f'{width}/{state}: exact full-copy bytes preserved', (root / (prefix + '.copy.txt')).read_bytes() == full_copy)
        check(f'{width}/{state}: complete backend handoff context unchanged', read(prefix + '.context.json') == context)
        if state != 'waiting':
            check(f'{width}/{state}: all baseline message blocks remain', len(layout['frames']) == len(baseline['frames']))
            check(f'{width}/{state}: every table cell and its ordering preserved', cell_identity(layout['tableCells']) == expected_cells)
            check(f'{width}/{state}: all math source preserved', read(prefix + '.math.json') == math)
        if state == 'receipts':
            samples = read(prefix + '.reflow.json')
            baseline_samples = read('baseline-900.png.reflow.json')
            check(f'{width}: same actual disclosure count as baseline', len(samples) == len(baseline_samples) and len(samples) > 0)
            check(f'{width}: resize/disclosure never overlaps and preserves all table content', all(
                s['intersections'] == 0 and s['minimumGap'] >= 12
                and cell_identity(s['tableCells']) == expected_cells
                and all(c['x'] >= 0 and c['x'] + c['width'] <= s['widthPoints'] + 1 and c['height'] > 0 for c in s['tableCells'])
                for s in samples))

failures = [c for c in checks if c['status'] == 'FAIL']
report = {'checks': checks, 'passed': len(checks) - len(failures), 'failed': len(failures),
          'baselineTableCells': len(expected_cells), 'baselineMessageBlocks': len(baseline['frames']),
          'copySHA256': hashlib.sha256(full_copy).hexdigest(), 'modelCalls': 0, 'liveStateWrites': 0,
          'rasterBoundary': 'Existing snapshot CLI caps at 20000 points; not a full-length image claim. Content, geometry, and real disclosure transitions checked separately.',
          'legacyTests': 'Original hard-coded 14-cell/16-toggle incident tests retained unchanged; this actual record has different content. Their failures are preserved in separate logs.'}
(root / 'continuity-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ('passed', 'failed', 'baselineTableCells', 'baselineMessageBlocks', 'modelCalls', 'liveStateWrites')}))
for c in failures:
    print(c['name'])
sys.exit(bool(failures))
