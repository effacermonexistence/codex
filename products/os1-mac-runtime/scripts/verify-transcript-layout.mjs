#!/usr/bin/env node
// Exact incident, same native paint/layout/disclosure delegate as the app.
// No model calls, network, clipboard writes or session mutations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
for (const name of ['--app', '--baseline-app', '--session', '--output-dir']) assert(args.includes(name) && option(name));
const app = path.resolve(option('--app')), baseline = path.resolve(option('--baseline-app'));
const sessionID = option('--session'), output = path.resolve(option('--output-dir'));
fs.mkdirSync(output, {recursive: true, mode: 0o700});
const source = path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json');
const before = fs.readFileSync(source);
const session = JSON.parse(before).sessions.find(s => s.id === sessionID);
assert(session);
const run = (exe, params) => execFileSync(exe, params, {encoding:'utf8', timeout:45000, maxBuffer:16*1024*1024});
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const beforeContext = JSON.parse(run(baseline, ['--export-session-context', sessionID]));
const checks = [], measurements = [];
const failures = [];
function check(name, fn) {
  try { fn(); checks.push({ name: name, status: 'PASS' }); }
  catch (error) { failures.push(name); checks.push({ name: name, status: 'FAIL', error: String(error && error.message || error) }); }
}
function cellsFit(cells, width) {
  for (const cell of cells) {
    assert(cell.height > 0 && cell.width > 0);
    assert(cell.x >= 0 && cell.x + cell.width <= width + 1, `table overflow at ${width}`);
  }
}
for (const width of [660, 900, 1100]) {
  for (const [state, flags] of [
    ['waiting', ['--waiting', '--receipt-open']], ['folded', []],
    ['receipts', ['--receipt-open', '--reflow-check']], ['expanded', ['--expanded']]
  ]) {
    const image = path.join(output, `${width}-${state}.png`);
    run(app, ['--render-session-transcript', sessionID, image, '--width', String(width), ...flags]);
    const layout = json(image + '.layout.json');
    check(`${width}/${state}: painted rectangles separated and on screen`, () => {
      assert(layout.pairs.length >= 4);
      for (const pair of layout.pairs) assert(!pair.intersects && pair.gapPoints >= 12, JSON.stringify(pair));
      for (const {paint} of layout.frames) {
        assert(paint.x >= 0 && paint.x + paint.width <= width + 1);
        assert(paint.y >= 0 && paint.y + paint.height <= layout.heightPoints, 'bottom clipping');
      }
      cellsFit(layout.tableCells, width);
    });
    measurements.push({width, state, minGapPoints:Math.min(...layout.pairs.map(p=>p.gapPoints)), pixelsPerPoint:layout.pixelsPerPoint});
    check(`${width}/${state}: full-copy and context unchanged`, () => {
      let offset = 0;
      const copy = fs.readFileSync(image+'.copy.txt', 'utf8');
      for (const message of session.messages) {
        const at = copy.indexOf(message.text, offset); assert(at >= offset, message.id);
        offset = at + message.text.length;
      }
      assert.deepEqual(json(image+'.context.json'), beforeContext);
    });
    if (state === 'receipts') {
      check(`${width}: actual answer table and formula, no leaked formatting`, () => {
        const cells = layout.tableCells;
        assert.equal(cells.length, 14, '7 rows including header, 2 columns');
        for (let row=0; row<7; row++) {
          const pair = cells.filter(c=>c.row===row);
          assert.equal(pair.length, 2); assert.equal(pair[0].y, pair[1].y);
          assert.equal(pair[0].height, pair[1].height);
          assert(Math.abs(pair[0].x+pair[0].width-pair[1].x)<=1);
        }
        const text = fs.readFileSync(image+'.txt','utf8');
        assert(text.includes('GR_COVARIANT_STRESS_TENSOR') && text.includes('PHYSICAL_DERIVATION'));
        assert(!text.includes('필요한 증거:') && !text.includes('**') && !text.includes('*출처:'));
        assert.equal(json(image+'.math.json').length, 1);
      });
      check(`${width}: resize and real disclosure delegate remain separated`, () => {
        const samples = json(image+'.reflow.json');
        assert.equal(samples.length, 16);
        for (const s of samples) { assert.equal(s.intersections, 0); assert(s.minimumGap >= 12); cellsFit(s.tableCells, s.widthPoints); }
      });
    }
  }
}
check('Session store byte-identical after all replays', () => assert.deepEqual(fs.readFileSync(source), before));
const report = {timestamp:new Date().toISOString(), app, appSHA256:hash(fs.readFileSync(app)), sessionID,
  checks, measurements, sessionStoreSHA256:hash(before), modelCalls:0,
  limitation:'Native AppKit raster/layout and actual disclosure delegate replay; not a physical drag or a pixel-identical Codex specification.'};
fs.writeFileSync(path.join(output,'report.json'), JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({passed:checks.length, failed: failures.length, minimumGapPoints:Math.min(...measurements.map(m=>m.minGapPoints)), report:path.join(output,'report.json')}));
process.exit(failures.length === 0 ? 0 : 1);
