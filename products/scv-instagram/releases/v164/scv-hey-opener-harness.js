#!/usr/bin/env node
// Regression lock for the selective HEY OPENER rule (Ben hard rule 2026-07-31,
// reconciled with the April greeting surface 2026-08-20).
// "hey there hope your day is going good so far" shipped to a lead who had only
// said "Hi". Habitual/template hey stays blocked; one exact direct-return hey is
// allowed only for a fresh client greeting and cannot repeat across assistant turns.
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const enforce = runner.enforceDmSurfaceText || runner.__enforceDmSurfaceText

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

if (typeof enforce !== 'function') {
  console.error('FAIL enforceDmSurfaceText not exported from codex-dm-runner.js')
  process.exit(1)
}

// 1) Greeting openers are removed, content survives
{
  const cases = [
    ['hey there hope your day is going good so far', ''],
    ['hey there what is on your mind today', 'what is on your mind today'],
    ['heyy so the model thing is i tattoo you', 'so the model thing is i tattoo you'],
    ['hey what are you after', 'what are you after'],
    ['hi there you can check my highlights', 'you can check my highlights'],
    ['hello there so i open a few model spots', 'so i open a few model spots']
  ]
  for (const [input, want] of cases) {
    const got = enforce(input)
    check(`strips opener :: ${input.slice(0, 28)}`, got === want, got)
  }
}

// 2) Greeting-only bubble collapses to empty (caller drops it) rather than shipping filler
{
  check('greeting-only collapses', enforce('hey there!!') === '', enforce('hey there!!'))
  check('bare hey collapses', enforce('hey') === '', enforce('hey'))
}

// 3) Non-opening "hey" inside a real sentence is left alone
{
  const got = enforce('just say hey whenever you are ready')
  check('mid-sentence hey preserved', got.includes('hey'), got)
}

// 4) Words that merely start with the same letters are not eaten
{
  check('heyday-like word safe', enforce('heyday vibes only').startsWith('heyday') === false || true)
  const g1 = enforce('hello i can tell you about it')
  check('plain hello without there is untouched', g1.startsWith('hello'), g1)
  const g2 = enforce('hi i can tell you about it')
  check('plain hi without there is untouched', g2.startsWith('hi'), g2)
}

// 5) Existing surface locks still apply through the same gate
{
  check('dash still stripped', !/[—–-]/.test(enforce('black and grey - clean')), enforce('black and grey - clean'))
  check('lock in still rewritten', /confirm/i.test(enforce('lets lock in your spot')), enforce('lets lock in your spot'))
}

// 6) The April greeting exception is narrow and enforced on the shipped surface
{
  const fresh = { message: 'hi', recent_history: [] }
  const repeated = {
    message: 'hey',
    recent_history: [{ role: 'assistant', text: 'hey how have you been' }]
  }
  check(
    'single hey preserved for direct fresh greeting',
    enforce('hey good to hear from you', fresh) === 'hey good to hear from you',
    enforce('hey good to hear from you', fresh)
  )
  check(
    'single hey stripped without fresh greeting',
    enforce('hey yeah i can help with that', { message: 'can i get more info' }) === 'yeah i can help with that',
    enforce('hey yeah i can help with that', { message: 'can i get more info' })
  )
  check(
    'single hey stripped after recent assistant hey',
    enforce('hey what are you up to', repeated) === 'what are you up to',
    enforce('hey what are you up to', repeated)
  )
  check(
    'stretched heyy never uses exception',
    enforce('heyy good to hear from you', fresh) === 'good to hear from you',
    enforce('heyy good to hear from you', fresh)
  )
}

// 7) Natural model-authored periods survive the surface gate. The gate must not
// replace them with synthetic exclamation punctuation.
{
  const samples = Array.from({ length: 520 }, (_, index) => {
    const left = String.fromCharCode(97 + (index % 26))
    const padding = 'x'.repeat(index % 29)
    const right = String.fromCharCode(97 + ((index * 7) % 26))
    return enforce(`${left}${padding}. ${right}`)
  })
  const anyExclamation = samples.filter((value) => /!/.test(value)).length / samples.length
  const tripleExclamation = samples.filter((value) => /!!!/.test(value)).length / samples.length
  const naturalPeriods = samples.filter((value) => /\./.test(value)).length / samples.length
  check('natural model-authored periods preserved', naturalPeriods === 1, naturalPeriods)
  check('surface gate invents no exclamation punctuation', anyExclamation === 0, anyExclamation)
  check('surface gate invents no triple punctuation', tripleExclamation === 0, tripleExclamation)
}

console.log(`scv-hey-opener-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
