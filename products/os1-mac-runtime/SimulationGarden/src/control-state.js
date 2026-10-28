// UI command custody only. Native SessionStore remains the execution authority.
// A receipt acknowledges host dispatch, never provider completion or cancellation.
const ACTIONS = new Set(['order', 'stop', 'resume', 'new']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Foundation encodes UUIDs in uppercase; crypto.randomUUID uses lowercase.
// Normalize identity keys, while retaining the native snapshot spelling in
// outgoing commands/results so UI selection and drafts keep their referent.
const uuidKey = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

export function newCommandID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw Error('명령 식별자를 만들 수 없습니다. 전송하지 않았습니다.');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export class SessionControls {
  constructor({ idFactory = newCommandID, now = () => Date.now() } = {}) {
    this.idFactory = idFactory; this.now = now;
    this.drafts = new Map(); this.revisions = new Map();
    this.pending = new Map(); this.slots = new Map();
    this.settledControls = new Map(); this.messages = new Map();
  }
  getDraft(id) { return this.drafts.get(uuidKey(id)) || ''; }
  setDraft(id, text, { edited = false } = {}) {
    const key = uuidKey(id); if (!key) return;
    if (edited || this.getDraft(id) !== text) this.revisions.set(key, (this.revisions.get(key) || 0) + 1);
    this.drafts.set(key, text);
  }
  slot(action, id) { return action === 'new' ? 'new' : `${action === 'resume' ? 'order' : action}:${uuidKey(id)}`; }
  isPending(action, id = null) { return this.slots.has(this.slot(action, id)); }
  isBlocked(action, id = null) {
    return this.isPending(action, id) || this.settledControls.has(`${action}:${uuidKey(id)}`);
  }
  begin(action, { sessionID = null, text = '' } = {}) {
    if (!ACTIONS.has(action) || (action !== 'new' && !UUID.test(sessionID || '')) || this.isBlocked(action, sessionID)) return null;
    if (action === 'order' && !text.trim()) return null;
    const commandID = this.idFactory();
    if (!uuidKey(commandID) || this.pending.has(uuidKey(commandID))) throw Error('명령 식별자 충돌 · 전송하지 않았습니다.');
    const entry = { commandID, action, sessionID, text, revision: this.revisions.get(uuidKey(sessionID)) || 0, sentAt: this.now(), unknown: false };
    this.pending.set(uuidKey(commandID), entry); this.slots.set(this.slot(action, sessionID), uuidKey(commandID));
    this.messages.delete(uuidKey(sessionID));
    return { action, commandID, ...(sessionID ? { id: sessionID } : {}), ...(action === 'order' ? { text } : {}) };
  }
  receive(receipt) {
    if (!receipt || typeof receipt !== 'object') return { matched: false };
    const entry = this.pending.get(uuidKey(receipt.commandID));
    if (!entry || receipt.action !== entry.action || typeof receipt.accepted !== 'boolean') return { matched: false };
    if (entry.action !== 'new' && uuidKey(receipt.sessionID) !== uuidKey(entry.sessionID)) return { matched: false };
    if (entry.action === 'new' && receipt.accepted && !UUID.test(receipt.sessionID || '')) return { matched: false };
    if (receipt.submissionID != null && !UUID.test(receipt.submissionID)) return { matched: false };
    this.pending.delete(uuidKey(entry.commandID)); this.slots.delete(this.slot(entry.action, entry.sessionID));
    // Keep duplicate Stop/Resume blocked until native state first reflects the
    // accepted control. A direct host receipt is not the reflected state.
    if (receipt.accepted && ['stop', 'resume'].includes(entry.action)) this.settledControls.set(`${entry.action}:${uuidKey(entry.sessionID)}`, entry);
    let clearedDraft = false;
    if (receipt.accepted && entry.action === 'order' && (this.revisions.get(uuidKey(entry.sessionID)) || 0) === entry.revision && this.getDraft(entry.sessionID) === entry.text) {
      this.setDraft(entry.sessionID, ''); clearedDraft = true;
    }
    const message = typeof receipt.message === 'string' ? receipt.message.slice(0, 2000) : '';
    this.messages.set(uuidKey(entry.sessionID), { message, accepted: receipt.accepted, action: entry.action });
    return { matched: true, action: entry.action, sessionID: entry.sessionID, accepted: receipt.accepted, clearedDraft, message, submissionID: receipt.submissionID || null };
  }
  observe(sessions) {
    for (const [key, entry] of this.settledControls) {
      const session = sessions.find(s => uuidKey(s.id) === uuidKey(entry.sessionID));
      if (!session || (entry.action === 'stop' ? !session.canStop : !session.canResume)) this.settledControls.delete(key);
    }
  }
  markOverdue(timeoutMS = 10000) {
    for (const entry of this.pending.values()) if (this.now() - entry.sentAt >= timeoutMS) entry.unknown = true;
    // Unknown custody remains pending. No timeout-driven replay or refund.
  }
  messageFor(id) {
    const pending = [...this.pending.values()].find(p => uuidKey(p.sessionID) === uuidKey(id));
    if (pending) return pending.unknown ? '명령 수신 확인 안 됨 · 원문 보존 · 자동 재전송 없음' : '명령 수신 확인 중…';
    return this.messages.get(uuidKey(id))?.message || '';
  }
}

export function sessionPresentation(session, controls) {
  const status = session?.status;
  const labels = {
    working: 'Gathering · 세션 실행 중', stopping: 'Stopping · 실제 종료 확인 중',
    paused: 'Paused · 대기열 일시정지', queued: `Queued · ${session?.queueCount || 0}건 대기`,
    failed: 'Idle · 확인 필요', completed: 'Idle · 작업 종료', idle: 'Idle · 명령 대기'
  };
  return {
    label: labels[status] || 'Idle · 명령 대기',
    dispatchDisabled: !session || ['working', 'stopping'].includes(status) || controls.isBlocked('order', session?.id),
    stopDisabled: !session?.canStop || controls.isBlocked('stop', session?.id),
    resumeVisible: !!session?.canResume,
    resumeDisabled: !session?.canResume || controls.isBlocked('resume', session?.id)
  };
}
