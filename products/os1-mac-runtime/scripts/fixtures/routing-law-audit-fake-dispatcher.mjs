// Build 447 (DESIGN-8 step 6): the paired-audit harness's zero-quota
// dispatcher. No provider, model or network: a deterministic stand-in answer
// per arm, drawing nothing. It exercises `routing-law-audit.mjs run` (cap,
// frozen checklists, answer lock, spend ledger) and `grade` without spending.
export const paid = false;
export async function dispatch({surface, model, effort, request}) {
  return {output: `[fixture ${surface}:${model}@${effort}] ${request.split('\n')[0]}`,
    draw: {pool: surface === 'codex' ? 'openai_codex' : 'anthropic_shared', units: 0}};
}
