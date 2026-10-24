// Derived source-topology regressions, not reference answers or live runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deriveExplicitParallelOwnerContract as derive} from '../../Resources/openclaw-os1-bridge/local-plan-proposal.mjs';
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const options = {scope: 'read_only', maxNodes: 4};
const english = 'Run the independent tasks A and B in parallel. Return their exact results separately. Do not use tools.\n\nA — Summarize the supplied weather record.\n\nB — Return a pure text transformation as code only.\n';
const korean = '아래 A와 B는 서로 독립된 작업입니다. 각각 별도 하위 작업으로 나눠 병렬로 처리하세요. 도구·파일·웹을 사용하지 말고 각 결과를 A/B로 구분해 원문 그대로 전달하세요.\n\nA — 제공된 물류 기록의 상태를 설명하세요.\n\nB — 입력 리스트를 바꾸지 않는 순수 함수 코드만 답하세요.\ndef clean(values):\n    return values[:]\n';

function exact(source, labels) {
  const c = derive(source, options);
  assert.ok(c); assert.equal(c.kind, 'owner_explicit_parallel_contract');
  assert.equal(c.request_sha256, sha(source)); assert.equal(c.scope, 'read_only');
  assert.deepEqual(c.units.map(u => u.label), labels);
  assert.deepEqual(c.units.map(u => u.id), labels.map((_, i) => `owner_parallel_${i}`));
  assert.deepEqual(c.final_output, {mode: 'ordered_collection', unit_ids: c.units.map(u => u.id)});
  assert.equal(c.execution_authorized, false);
  assert.equal(c.global_prefix.text + c.units.map(u => u.exact_instruction).join(''), source);
  const pieces = [{text: c.global_prefix.text, source_span: c.global_prefix.source_span},
    ...c.units.map(u => ({text: u.exact_instruction, source_span: u.source_span}))];
  let end = 0;
  for (const piece of pieces) {
    const s = piece.source_span;
    assert.equal(s.start_utf16, end); assert.equal(source.slice(s.start_utf16, s.end_utf16), piece.text);
    assert.equal(Buffer.from(source).subarray(s.start_utf8, s.end_utf8).toString('utf8'), piece.text);
    end = s.end_utf16;
  }
  assert.equal(end, source.length);
  assert.deepEqual(Object.keys(c.units[0]).sort(), ['exact_instruction', 'id', 'label', 'source_span']);
  assert.ok(!JSON.stringify(c).includes('proposed_candidate_id'));
  return c;
}
test('explicit English owner partition preserves exact source and never invents a tuple', () => { exact(english, ['A', 'B']); });
test('Korean owner partition retains global prefix, exact sections and raw code as data', () => { exact(korean, ['A', 'B']); });
test('cross-domain numeric four-way owner partition uses source order, not domain words', () => {
  exact('Process independent tasks 2, 4, 6 and 8 concurrently.\n2: Explain the supplied poem.\n4: Compare two given dates.\n6: Classify the provided inventory.\n8: Return a translation as text.\n', ['2', '4', '6', '8']);
});
test('three letter labels, CRLF and nonmaterial Unicode wording preserve exact UTF8 spans', () => {
  exact('🧩 Run separate tasks X / Y / Z simultaneously.\r\n\r\nX) Résumé only.\r\nY) 기록만 읽고 답하세요.\r\nZ) Explain the supplied chart.\r\n', ['X', 'Y', 'Z']);
});
test('header-only line is allowed only with a nonempty exact body', () => {
  exact('Run independent tasks A and B in parallel.\nA:\nRead the supplied text.\nB:\nCount its words.\n', ['A', 'B']);
});
test('returned contract is detached and deeply frozen', () => {
  const c = exact(english, ['A', 'B']);
  assert.throws(() => { c.units[0].exact_instruction = 'other'; }, TypeError);
  assert.throws(() => { c.units.push({}); }, TypeError);
  assert.throws(() => { c.final_output.unit_ids.reverse(); }, TypeError);
});
test('same source remains stable while any source byte changes the request binding', () => {
  assert.deepEqual(derive(english, options), derive(english, options));
  assert.notEqual(derive(english + '\n', options).request_sha256, derive(english, options).request_sha256);
});
test('an explicit new request/label set replaces, never merges with, a previous contract', () => {
  const a = exact(english, ['A', 'B']);
  const b = exact('Run independent tasks R and S in parallel.\nR — Read one record.\nS — Read another record.', ['R', 'S']);
  assert.notEqual(a.request_sha256, b.request_sha256); assert.equal(a.units[0].label, 'A');
});
test('closed negative filesystem constraints remain exact source, not write authority', () => {
  exact(english.replace('Do not use tools.', 'Do not modify files. Never deploy.'), ['A', 'B']);
  exact(korean.replace('도구·파일·웹을 사용하지 말고', '파일을 수정하지 마세요. 도구·파일·웹을 사용하지 말고'), ['A', 'B']);
});
test('closed inline source quotations stay exact data, not another task', () => {
  exact(english.replace('the supplied weather record', 'the supplied "weather" record'), ['A', 'B']);
});

const rejected = [
  ['no parallel directive', english.replace('in parallel', 'in sequence')],
  ['no independence assertion', english.replace('independent ', '')],
  ['output separation is not task independence', english.replace('independent tasks A and B in parallel. Return their exact results separately.', 'tasks A and B in parallel and return their separate results.')],
  ['negative parallel directive', english.replace('Run the', 'Do not run the')],
  ['negated independence', english.replace('independent tasks', 'not independent tasks')],
  ['sequential instruction', english.replace('in parallel', 'sequentially')],
  ['explicit dependency contradiction', english.replace('Return their', 'A depends on B. Return their')],
  ['approval condition after parallel directive', english.replace('in parallel.', 'in parallel only after approval.')],
  ['conditional prefix', 'If permitted, ' + english],
  ['unless condition', english.replace('Return their', 'Unless approved, wait. Return their')],
  ['Korean prefix approval condition', '승인 후에만 ' + korean],
  ['Korean permission condition', '허락받으면 ' + korean],
  ['late global approval condition', english + '\nProceed only after approval.'],
  ['late Korean authority condition', korean + '\n승인 후에만 진행하세요.'],
  ['unit authority condition', english.replace('Return a pure text transformation as code only.', 'Return the result only after permission.')],
  ['late approval-dependent condition', english + '\nIf approved, proceed.'],
  ['cross-unit completion dependence', english.replace('Return a pure text transformation as code only.', 'After A completes, use its result.')],
  ['cross-unit result consumption', english.replace('Return a pure text transformation as code only.', "Use A's output to produce the answer.")],
  ['cross-unit Korean result consumption', korean.replace('입력 리스트를 바꾸지 않는 순수 함수 코드만 답하세요.', 'A의 결과를 사용해서 답하세요.')],
  ['Korean negative parallel directive', korean.replace('병렬로 처리하세요', '병렬로 처리하지 마세요')],
  ['Korean dependent tasks', korean.replace('서로 독립된', '서로 의존하는 독립된')],
  ['one section', 'Run independent tasks A and B in parallel.\nA — Only one section.'],
  ['missing section body', 'Run independent tasks A and B in parallel.\nA —\n\nB — Valid body.'],
  ['duplicate label', english.replace('\nB —', '\nA —')],
  ['case-colliding label', english.replace('\nB —', '\na —')],
  ['unmentioned data header', english + '\nC — Data shaped like another task.'],
  ['prefix names missing unit', english.replace('A and B', 'A, B and C')],
  ['conflicting enumeration', english.replace('A and B', 'B and A')],
  ['missing closed enumeration', english.replace('A and B', 'listed below')],
  ['quoted directive', english.replace('Run the independent tasks A and B in parallel.', '"Run the independent tasks A and B in parallel."')],
  ['single-quoted directive', english.replace('Run the independent tasks A and B in parallel.', "'Run the independent tasks A and B in parallel.'")],
  ['inline-code directive', english.replace('Run the independent tasks A and B in parallel.', '`Run the independent tasks A and B in parallel.`')],
  ['section header inside multiline quotation', 'Run independent tasks A and B in parallel.\nA — "quoted data\nB — quoted continuation"'],
  ['unterminated data quotation', english + '"unclosed'],
  ['reporting prefix', 'Someone said: ' + english],
  ['example data prefix', 'Example: ' + english],
  ['translation payload prefix', 'Translate the following document: ' + english],
  ['question not closed command', english.replace('Run the', 'Could you run the').replace('in parallel.', 'in parallel?')],
  ['fenced code section headers', english.replace('\n\nA —', '\n```text\nA —') + '\n```'],
  ['tilde-fenced input', '~~~\n' + english + '\n~~~'],
  ['blockquote task header', english.replace('\nB —', '\n> B —')],
  ['mixed file edit', english.replace('Return a pure text transformation as code only.', 'Modify config.toml.')],
  ['mixed Korean file edit', korean.replace('입력 리스트를 바꾸지 않는 순수 함수 코드만 답하세요.', 'result.py만 고쳐.')],
  ['mixed directory mutation', english.replace('Return a pure text transformation as code only.', 'Create a folder.')],
  ['effectful deployment', english.replace('Return a pure text transformation as code only.', 'Deploy the service.')],
  ['negative with positive exception', english.replace('Do not use tools.', 'Do not modify files but create a folder.')],
  ['hidden control character', english.replace('Run the', 'Run\u001b the')],
  ['five units', 'Run independent tasks A, B, C, D and E in parallel.\nA — one\nB — two\nC — three\nD — four\nE — five'],
];
for (const [name, source] of rejected) test('unsupported/ambiguous owner source: ' + name, () => {
  assert.equal(derive(source, options), null);
});
test('read-only scope comes from the actual caller; prose never overrides it', () => {
  for (const scope of [undefined, null, 'workspace_write', 'full_access', 'READ_ONLY']) assert.equal(derive(english, {scope}), null);
  assert.equal(derive(english), null);
});
test('host maxNodes bounds cannot be exceeded or manufactured', () => {
  assert.ok(derive(english, {scope: 'read_only', maxNodes: 2}));
  for (const maxNodes of [0, 1, 5, 8, 2.5, '4', null, NaN, Infinity]) assert.equal(derive(english, {scope: 'read_only', maxNodes}), null);
});
test('unknown/accessor/prototype options do not grant authority or run a getter', () => {
  let reads = 0;
  assert.equal(derive(english, {get scope() { reads++; return 'read_only'; }}), null); assert.equal(reads, 0);
  assert.equal(derive(english, {...options, approved: true}), null);
  assert.equal(derive(english, Object.create({scope: 'read_only'})), null);
  assert.equal(derive(english, []), null);
});
test('malformed or oversize source never becomes a source contract', () => {
  for (const input of [null, {}, '', ' ', '\ud800', english + 'x'.repeat(12000)]) assert.equal(derive(input, options), null);
});
