// One stable UUID is one worker. Roster pagination never limits the battlefield.
// Native review is authoritative; a local selection is not a completion receipt.
export const isRunning = s => s?.status === 'working';
export const isAwaitingReview = s => s?.hasResult === true && s?.resultPending === true && s?.reviewed !== true && !isRunning(s) && s.status !== 'queued';
export function battlefieldSessions(sessions, deployedIDs = new Set()) {
 return sessions.filter(s => isRunning(s) || s.status === 'queued' || (s.featured === true && s.reviewed !== true) || isAwaitingReview(s) || (s.reviewed !== true && deployedIDs.has(s.id)));
}
export function tokenState(pool) {
 const nonnegative = n => Number.isFinite(n) && n >= 0 ? n : null;
 const percent=nonnegative(pool?.remainingPercent);
 const remaining = nonnegative(pool?.remaining), capacity = nonnegative(pool?.capacity), used = nonnegative(pool?.used);
 return { used, remaining, capacity, ratio:remaining !== null && capacity !== null && capacity > 0 && remaining <= capacity ? remaining / capacity : null, remainingPercent:percent !== null && percent <= 100 ? percent : null, label:pool?.label || '토큰', source:pool?.source || '공급자가 잔여 토큰을 제공하지 않음' };
}
export function canAcknowledge(session, displayed) {
 return isAwaitingReview(session) && !!session.resultRevision && displayed?.id === session.id && displayed?.revision === session.resultRevision && displayed?.hasOutput === true;
}

export function workerRace(session){const e=String(session?.engine||'').toLowerCase();return /claude|anthropic/.test(e)?'protoss':/codex|clodex/.test(e)?'terran':'unresolved';}
