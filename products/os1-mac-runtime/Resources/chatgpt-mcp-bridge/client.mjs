// OS1-side mailbox client. No model invocation, browser, native host pipe,
// account fallback, or retry authority lives here.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatGPTMailbox } from './store.mjs';

export async function waitForReturn(store, requestID, {timeoutMS = 120_000, signal} = {}) {
  const end = Date.now() + timeoutMS;
  while (true) {
    const result = store.status(requestID);
    if (!['queued', 'offered', 'dispatched'].includes(result.state ?? result.status)) return result;
    if (signal?.aborted) return store.cancel(requestID);
    if (Date.now() >= end) {
      // An uncertain timeout is not a resend authorization. Leave the journal
      // intact so a caller can inspect or explicitly cancel this same request.
      return {...result, wait_timed_out: true, retry_safe: false};
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function main() {
  const args = process.argv.slice(2), command = args.shift();
  const take = flag => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('argument_missing');
    return args.splice(i, 2)[1];
  };
  const root = take('--root') ?? resolve(homedir(), '.os1/chatgpt-mcp-transport');
  const requestFile = take('--request-file'), requestID = take('--request-id');
  if (args.length || !['enqueue', 'status', 'wait', 'cancel'].includes(command)) throw Error('arguments_invalid');
  const store = new ChatGPTMailbox(root);
  try {
    let result;
    if (command === 'enqueue') {
      if (!requestFile || requestID) throw Error('request_file_required');
      const raw = readFileSync(requestFile);
      if (raw.length > 100_000) throw Error('request_too_large');
      result = store.enqueue(JSON.parse(raw));
    } else {
      if (!requestID || requestFile) throw Error('request_id_required');
      result = command === 'wait' ? await waitForReturn(store, requestID) : store[command](requestID);
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    if (command === 'wait' && (result.state ?? result.status) !== 'returned') process.exitCode = 2;
  } finally { store.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('ChatGPT MCP mailbox operation failed; no fallback invoked.\n'); process.exitCode = 1; });
}
