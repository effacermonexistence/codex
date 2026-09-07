#!/usr/bin/env node
// Read-only replay of a real conversation through the installed native renderer.
// Diagnostic artifacts are private: they contain the user's original messages.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--app', '--baseline-app', '--session', '--output-dir']) assert(args.includes(name) && option(name), `Missing ${name}`);
const app = path.resolve(option('--app')), baseline = path.resolve(option('--baseline-app'));
const sessionID = option('--session'), output = path.resolve(option('--output-dir'));
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const sourceFile = path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json');
const before = fs.readFileSync(sourceFile);
const session = JSON.parse(before).sessions.find(value => value.id === sessionID);
assert(session);
const digest = data => createHash('sha256').update(data).digest('hex');
const run = (exe, argv) => execFileSync(exe, argv, { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
// Mirror TranscriptMarkdown's source grammar: fenced code is literal, display
// delimiters on their own lines preserve the whole exact block, and inline
// delimiters preserve their original escaping. This is an oracle for source
// retention, not an independent TeX parser.
function expectedMathSources(source) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const formulas = [];
  const inline = /`[^`]*`|(?<!\\)\$\$[^$]+\$\$|(?<![\\$])\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$(?!\$)|\\\(.+?\\\)|\\\[.+?\\\]/g;
  for (let index = 0; index < lines.length;) {
    const trimmed = lines[index].trim();
    if (trimmed === '$$' || trimmed === '\\[') {
      const close = trimmed === '$$' ? '$$' : '\\]';
      const end = lines.findIndex((line, candidate) => candidate > index && line.trim() === close);
      if (end > index) {
        formulas.push(lines.slice(index, end + 1).join('\n'));
        index = end + 1;
        continue;
      }
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const fence = trimmed.slice(0, 3);
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence)) index += 1;
      index += 1;
      continue;
    }
    for (const match of lines[index].matchAll(inline)) {
      if (!match[0].startsWith('`')) formulas.push(match[0]);
    }
    index += 1;
  }
  return formulas;
}
const checks = [];
const failures = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { failures.push(name); checks.push({ name, status: 'FAIL', error: String(error && error.message || error) }); }
}
check('Math-source oracle preserves inline, display and escaped delimiter boundaries', () => {
  const fixture = 'inline $x_1$ and \\(y\\)\n$$\n\\operatorname{diag}(A)\n$$\n`$code$`\n```tex\n$also_code$\n```\nescaped \\$5';
  assert.deepEqual(expectedMathSources(fixture), [
    '$x_1$', '\\(y\\)', '$$\n\\operatorname{diag}(A)\n$$',
  ]);
});
check('Native regression: math, selection, pin/archive/rename/search/drafts/queue and process activity', () => {
  assert(run(app, ['--self-test']).includes('self-test: OK'));
});
const image = path.join(output, 'conversation.png');
run(app, ['--render-session-transcript', sessionID, image]);
const formulas = JSON.parse(fs.readFileSync(image + '.math.json', 'utf8'));
const expected = session.messages.filter(m => m.role === 'assistant' && m.provider !== 'local')
  .flatMap(m => expectedMathSources(m.text));
check('Every formula in exact reported assistant response typeset', () => {
  assert(expected.length >= 10, 'Must test a real mathematical answer');
  assert.deepEqual(formulas, expected);
});
check('Native full selection preserves every formula source', () => {
  const copy = fs.readFileSync(image + '.txt', 'utf8');
  assert(expected.every(formula => copy.includes(formula)));
});
check('Complete-copy preserves all original messages and receipts in order', () => {
  const copy = fs.readFileSync(image + '.copy.txt', 'utf8');
  let offset = 0;
  for (const message of session.messages) {
    const index = copy.indexOf(message.text, offset);
    assert(index >= offset, `Missing original ${message.id}`);
    offset = index + message.text.length;
  }
});
check('Backend handoff and source snapshot unchanged', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(image + '.context.json', 'utf8')),
    JSON.parse(run(baseline, ['--export-session-context', sessionID])));
});
run(app, ['--render-activity-preview', output]);
check('Activity animation frames differ while elapsed second is the same', () => {
  assert.notEqual(digest(fs.readFileSync(path.join(output, 'activity-0.png'))),
    digest(fs.readFileSync(path.join(output, 'activity-1.png'))));
});
check('Long quiet-stage preview renders', () => assert(fs.statSync(path.join(output, 'activity-2.png')).size > 1000));
check('Read-only validation preserves all session-store bytes', () =>
  assert(fs.readFileSync(sourceFile).equals(before), 'Session store changed during native replay'));
const report = { timestamp: new Date().toISOString(), app, appSHA256: digest(fs.readFileSync(app)),
  sessionID, renderedFormulas: formulas.length, modelCalls: 0, sessionStoreSHA256: digest(before), checks,
  limitation: 'Native AppKit/SwiftUI diagnostic replay, not physical mouse/keyboard or foreground-window automation.' };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: checks.length, failed: failures.length, renderedFormulas: formulas.length, modelCalls: 0, report: path.join(output, 'report.json') }));
process.exit(failures.length === 0 ? 0 : 1);
