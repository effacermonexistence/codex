import {DatabaseSync} from 'node:sqlite';
import {constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

// A transport mailbox, not a task planner, scheduler, retry loop or quota meter.
// The authenticated host's admission remains outside this local persistence layer.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['returned', 'cancelled', 'expired', 'effects_uncertain']);
const MAX_PROMPT = 40_000, MAX_POLICY = 32_000, MAX_OUTPUT = 256_000;
const MAX_LIFETIME = 3_600_000;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export class MailboxError extends Error {
  constructor(code) { super(code); this.name = 'MailboxError'; this.code = code; }
}
function requireThat(ok, code) { if (!ok) throw new MailboxError(code); }
function id(value) { return typeof value === 'string' && ID.test(value); }
function text(value, max, empty = false) {
  return typeof value === 'string' && (empty || value.trim().length > 0) &&
    !value.includes('\0') && Buffer.byteLength(value) <= max;
}
function keys(value, required, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function token() { return randomBytes(32).toString('hex'); }
function matches(value, digest) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || !HASH.test(digest ?? '')) return false;
  return timingSafeEqual(Buffer.from(sha256(value), 'hex'), Buffer.from(digest, 'hex'));
}
function ownedPrivate(path, directory) {
  const st = lstatSync(path);
  requireThat(!st.isSymbolicLink() && (directory ? st.isDirectory() : st.isFile()) &&
    st.uid === process.getuid() && (st.mode & 0o077) === 0 &&
    (directory || st.nlink === 1), 'mailbox_custody_rejected');
  return st;
}
function openPrivateRoot(input) {
  requireThat(typeof input === 'string' && isAbsolute(input) && !input.includes('\0'), 'mailbox_root_invalid');
  const absolute = resolve(input);
  // Refuse symlinks in any pre-existing path component. Callers may canonicalize
  // macOS /tmp explicitly; this function never silently changes the authority root.
  let prefix = '/';
  for (const part of absolute.split('/').filter(Boolean)) {
    prefix = join(prefix, part);
    if (existsSync(prefix)) requireThat(!lstatSync(prefix).isSymbolicLink(), 'mailbox_root_symlink');
    else mkdirSync(prefix, {mode: 0o700});
  }
  ownedPrivate(absolute, true);
  requireThat(realpathSync(absolute) === absolute, 'mailbox_root_changed');
  return {root: absolute, identity: statSync(absolute)};
}

export class ChatGPTMailbox {
  constructor(root, {now = () => Date.now(), leaseMs = 60_000} = {}) {
    requireThat(typeof now === 'function' && Number.isSafeInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 300_000,
      'mailbox_configuration_invalid');
    this.now = now; this.leaseMs = leaseMs;
    const opened = openPrivateRoot(root); this.root = opened.root; this.rootIdentity = opened.identity;
    this.databasePath = join(this.root, 'mailbox.sqlite');
    const fd = openSync(this.databasePath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const st = fstatSync(fd);
      requireThat(st.isFile() && st.uid === process.getuid() && (st.mode & 0o077) === 0 && st.nlink === 1,
        'mailbox_database_custody_rejected');
    } finally { closeSync(fd); }
    ownedPrivate(this.databasePath, false);
    // Private root prevents other users from placing SQLite journal companions.
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const file = this.databasePath + suffix;
      if (existsSync(file)) ownedPrivate(file, false);
    }
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS connections(
        connection_id TEXT PRIMARY KEY, created_at_ms INTEGER NOT NULL,
        observed_at_ms INTEGER NOT NULL, lease_until_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(
        request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
        policy_sha256 TEXT NOT NULL, prompt TEXT NOT NULL, policy_text TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, state TEXT NOT NULL,
        connection_id TEXT, offered_at_ms INTEGER, dispatched_at_ms INTEGER, returned_at_ms INTEGER,
        terminal_at_ms INTEGER, dispatch_hash TEXT, return_hash TEXT, output TEXT, output_sha256 TEXT);
      CREATE TABLE IF NOT EXISTS events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT,
        kind TEXT NOT NULL, observed_at_ms INTEGER NOT NULL, metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS request_state ON requests(state,created_at_ms);`);
    this.databaseIdentity = statSync(this.databasePath);
    this._custody();
  }
  _time() { const n = this.now(); requireThat(Number.isSafeInteger(n) && n >= 0, 'mailbox_clock_invalid'); return n; }
  _custody() {
    const root = ownedPrivate(this.root, true), database = ownedPrivate(this.databasePath, false);
    requireThat(root.dev === this.rootIdentity.dev && root.ino === this.rootIdentity.ino &&
      database.dev === this.databaseIdentity.dev && database.ino === this.databaseIdentity.ino,
      'mailbox_identity_changed');
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const file = this.databasePath + suffix;
      if (existsSync(file)) ownedPrivate(file, false);
    }
  }
  _transaction(fn) {
    this._custody(); this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); this._custody(); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  _diagnosticAllowed(requestID, now) {
    try {
      const path = join(this.root, 'activation.json');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const st = fstatSync(fd);
        requireThat(st.isFile() && st.uid === process.getuid() && (st.mode & 0o077) === 0 &&
          st.nlink === 1 && st.size > 0 && st.size <= 8_192, 'activation_custody_invalid');
        bytes = readFileSync(fd, 'utf8');
      } finally { closeSync(fd); }
      const value = JSON.parse(bytes);
      return keys(value, ['schema','mode','request_ids','expires_at_ms']) && value.schema === 1 &&
        value.mode === 'diagnostic_only' && Array.isArray(value.request_ids) &&
        value.request_ids.length > 0 && value.request_ids.length <= 16 &&
        value.request_ids.every(id) && new Set(value.request_ids).size === value.request_ids.length &&
        value.request_ids.includes(requestID) && Number.isSafeInteger(value.expires_at_ms) &&
        value.expires_at_ms > now && value.expires_at_ms <= now + MAX_LIFETIME;
    } catch { return false; }
  }
  _event(requestID, kind, now, metadata = {}) {
    this.db.prepare('INSERT INTO events(request_id,kind,observed_at_ms,metadata) VALUES(?,?,?,?)')
      .run(requestID, kind, now, JSON.stringify(metadata));
  }
  _expire(now) {
    for (const row of this.db.prepare("SELECT request_id,state FROM requests WHERE expires_at_ms<=? AND state IN ('queued','offered','dispatched')").all(now)) {
      const state = row.state === 'queued' ? 'expired' : 'effects_uncertain';
      this.db.prepare('UPDATE requests SET state=?,terminal_at_ms=? WHERE request_id=?').run(state, now, row.request_id);
      this._event(row.request_id, state, now, {previous_state: row.state, replay_authorized: false});
    }
  }
  _row(requestID) {
    requireThat(id(requestID), 'request_id_invalid');
    const row = this.db.prepare('SELECT * FROM requests WHERE request_id=?').get(requestID);
    requireThat(row, 'request_not_found'); return row;
  }
  _public(row) {
    return {request_id: row.request_id, task_id: row.task_id,
      request_sha256: row.request_sha256, policy_sha256: row.policy_sha256,
      state: row.state, created_at_ms: row.created_at_ms, expires_at_ms: row.expires_at_ms,
      offered_at_ms: row.offered_at_ms, dispatched_at_ms: row.dispatched_at_ms,
      returned_at_ms: row.returned_at_ms, terminal_at_ms: row.terminal_at_ms,
      dispatch_acknowledged: row.dispatched_at_ms !== null,
      output: row.output, output_sha256: row.output_sha256,
      execution_source: row.state === 'returned' ? 'mcp_result_tool_callback' : null,
      host_mode: 'NOT_EXPOSED', model: 'NOT_EXPOSED', effort: 'NOT_EXPOSED', quota: 'NOT_EXPOSED',
      usage_accounting_verified: false, native_record_verified: false,
      host_authentication_verified: false, host_registration_verified: false,
      task_quality: 'unverified', parity_state: 'unverified', mode: 'diagnostic_only', production_available: false};
  }
  enqueue(input) {
    requireThat(keys(input, ['request_id','task_id','request_sha256','policy_sha256','prompt','policy_text'], ['expires_at_ms','diagnostic']) &&
      id(input.request_id) && id(input.task_id) && HASH.test(input.request_sha256) && HASH.test(input.policy_sha256) &&
      text(input.prompt, MAX_PROMPT) && text(input.policy_text, MAX_POLICY, true) &&
      sha256(input.prompt) === input.request_sha256 && sha256(input.policy_text) === input.policy_sha256,
      'request_binding_invalid');
    return this._transaction(() => {
      const now = this._time(); this._expire(now);
      requireThat(input.diagnostic === true && this._diagnosticAllowed(input.request_id,now), 'diagnostic_activation_required');
      const prior = this.db.prepare('SELECT * FROM requests WHERE request_id=?').get(input.request_id);
      if (prior) {
        requireThat(['task_id','request_sha256','policy_sha256','prompt','policy_text'].every(k => prior[k] === input[k]) &&
          (input.expires_at_ms === undefined || input.expires_at_ms === prior.expires_at_ms), 'request_id_conflict');
        return {...this._public(prior), idempotent: true};
      }
      const expires = input.expires_at_ms ?? now + 900_000;
      requireThat(Number.isSafeInteger(expires) && expires > now && expires <= now + MAX_LIFETIME, 'request_expiry_invalid');
      this.db.prepare('INSERT INTO requests(request_id,task_id,request_sha256,policy_sha256,prompt,policy_text,created_at_ms,expires_at_ms,state) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.request_id,input.task_id,input.request_sha256,input.policy_sha256,input.prompt,input.policy_text,now,expires,'queued');
      this._event(input.request_id,'queued',now);
      return this._public(this._row(input.request_id));
    });
  }
  connect(connectionID) {
    requireThat(connectionID === undefined || id(connectionID), 'connection_id_invalid');
    return this._transaction(() => {
      const now = this._time(); this._expire(now);
      if (connectionID) {
        requireThat(this.db.prepare('SELECT connection_id FROM connections WHERE connection_id=?').get(connectionID), 'connection_unknown');
        const other = this.db.prepare('SELECT connection_id FROM connections WHERE lease_until_ms>? AND connection_id!=?').get(now, connectionID);
        requireThat(!other, 'connection_already_active');
      } else {
        requireThat(!this.db.prepare('SELECT connection_id FROM connections WHERE lease_until_ms>?').get(now), 'connection_already_active');
        connectionID = 'chat-' + randomBytes(24).toString('hex');
        this.db.prepare('INSERT INTO connections VALUES(?,?,?,?)').run(connectionID,now,now,now+this.leaseMs);
      }
      this.db.prepare('UPDATE connections SET observed_at_ms=?,lease_until_ms=? WHERE connection_id=?')
        .run(now,now+this.leaseMs,connectionID);
      return {connection_id: connectionID, lease_until_ms: now+this.leaseMs,
        host_mode:'NOT_EXPOSED',model:'NOT_EXPOSED',effort:'NOT_EXPOSED',quota:'NOT_EXPOSED'};
    });
  }
  _connection(connectionID, now) {
    requireThat(id(connectionID), 'connection_id_invalid');
    const row = this.db.prepare('SELECT * FROM connections WHERE connection_id=?').get(connectionID);
    requireThat(row && row.lease_until_ms > now, 'connection_lease_expired'); return row;
  }
  connectionStatus() {
    this._custody(); const now=this._time();
    const row=this.db.prepare('SELECT observed_at_ms,lease_until_ms FROM connections WHERE lease_until_ms>? ORDER BY observed_at_ms DESC LIMIT 1').get(now);
    return {state:row?'connected':'unavailable',observed_at_ms:row?.observed_at_ms??null,
      lease_until_ms:row?.lease_until_ms??null,production_available:false,mode:'diagnostic_only',host_mode:'NOT_EXPOSED',model:'NOT_EXPOSED',effort:'NOT_EXPOSED',quota:'NOT_EXPOSED'};
  }
  next(connectionID) {
    return this._transaction(() => {
      const now = this._time(); this._expire(now); this._connection(connectionID,now);
      // At most one delivery across every widget. A restart/other widget cannot
      // silently resend a previously offered request or overtake an active one.
      const uncertain=this.db.prepare("SELECT request_id FROM requests WHERE state='effects_uncertain' ORDER BY created_at_ms,request_id LIMIT 1").get();
      if(uncertain) return {state:'blocked',request_id:uncertain.request_id,reason:'previous_delivery_outcome_uncertain'};
      const active=this.db.prepare("SELECT request_id,state FROM requests WHERE state IN ('offered','dispatched') ORDER BY created_at_ms,request_id LIMIT 1").get();
      if(active) return {state:'busy',request_id:active.request_id,status:active.state};
      const row=this.db.prepare("SELECT * FROM requests WHERE state='queued' ORDER BY created_at_ms,request_id LIMIT 1").get();
      if(!row) return {state:'idle'};
      if(!this._diagnosticAllowed(row.request_id,now)) return {state:'blocked',request_id:row.request_id,reason:'diagnostic_activation_required'};
      const dispatch=token(),returned=token();
      this.db.prepare("UPDATE requests SET state='offered',connection_id=?,offered_at_ms=?,dispatch_hash=?,return_hash=? WHERE request_id=? AND state='queued'")
        .run(connectionID,now,sha256(dispatch),sha256(returned),row.request_id);
      this._event(row.request_id,'offered_once',now,{replay_authorized:false});
      return {state:'offered',request:{request_id:row.request_id,task_id:row.task_id,
        request_sha256:row.request_sha256,policy_sha256:row.policy_sha256,prompt:row.prompt,policy_text:row.policy_text,
        created_at_ms:row.created_at_ms,expires_at_ms:row.expires_at_ms,dispatch_token:dispatch,return_token:returned}};
    });
  }
  dispatched(requestID, dispatchToken) {
    return this._transaction(() => {
      const now=this._time(); this._expire(now); const row=this._row(requestID);
      requireThat(matches(dispatchToken,row.dispatch_hash),'dispatch_token_invalid');
      if(row.state==='dispatched'||row.state==='returned') return {...this._public(row),idempotent:true};
      requireThat(row.state==='offered','dispatch_not_active');
      this.db.prepare("UPDATE requests SET state='dispatched',dispatched_at_ms=? WHERE request_id=?").run(now,requestID);
      this._event(requestID,'message_submission_acknowledged',now,{completed:false});
      return this._public(this._row(requestID));
    });
  }
  complete(input) {
    requireThat(keys(input,['request_id','request_sha256','policy_sha256','return_token','output']) &&
      id(input.request_id) && HASH.test(input.request_sha256) && HASH.test(input.policy_sha256) && text(input.output,MAX_OUTPUT),
      'result_shape_invalid');
    return this._transaction(() => {
      const now=this._time(); this._expire(now); const row=this._row(input.request_id);
      requireThat(row.request_sha256===input.request_sha256&&row.policy_sha256===input.policy_sha256&&
        matches(input.return_token,row.return_hash),'result_binding_invalid');
      if(row.state==='returned') {
        requireThat(row.output===input.output&&row.output_sha256===sha256(input.output),'result_conflict');
        return {...this._public(row),idempotent:true};
      }
      requireThat(row.state==='offered'||row.state==='dispatched','result_not_active');
      this.db.prepare("UPDATE requests SET state='returned',returned_at_ms=?,terminal_at_ms=?,output=?,output_sha256=? WHERE request_id=?")
        .run(now,now,input.output,sha256(input.output),input.request_id);
      this._event(input.request_id,'result_callback_received',now,{output_sha256:sha256(input.output),
        dispatch_acknowledged:row.dispatched_at_ms!==null,quota_verified:false});
      return this._public(this._row(input.request_id));
    });
  }
  status(requestID, connectionID) {
    return this._transaction(() => {
      const now=this._time(); this._expire(now); const row=this._row(requestID);
      if(connectionID!==undefined) {
        this._connection(connectionID,now);
        requireThat(row.connection_id===connectionID,'request_connection_mismatch');
      }
      return this._public(row);
    });
  }
  cancel(requestID) {
    return this._transaction(() => {
      const now=this._time(); this._expire(now);const row=this._row(requestID);
      if(TERMINAL.has(row.state)) return {...this._public(row),idempotent:true};
      this.db.prepare("UPDATE requests SET state='cancelled',terminal_at_ms=? WHERE request_id=?").run(now,requestID);
      this._event(requestID,'cancelled',now,{previous_state:row.state,
        host_cancellation_supported:false,replay_authorized:false});
      return this._public(this._row(requestID));
    });
  }
  close(){this.db.close();}
}
