import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readDeliveryManifest, checkedRoot, noSymlink, fileIdentity } = require('./motion-static.cjs');
const CHUNK_TIMEOUT_MS = 30_000;
const ASSET_TIMEOUT_MS = 180_000;
export async function assembleMotionMedia({ root, fetchImpl = globalThis.fetch } = {}) {
  root = checkedRoot(root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const manifest = readDeliveryManifest(root), output = path.join(root, 'site', 's');
  noSymlink(root, output, true); fs.mkdirSync(output, { recursive: true }); noSymlink(root, output);
  const results = [];
  for (const asset of manifest.assets) {
    const destination = path.join(output, asset.file); noSymlink(root, destination, true);
    if (fs.existsSync(destination)) {
      const identity = fileIdentity(destination);
      if (identity.bytes === asset.bytes && identity.sha256 === asset.sha256) { results.push({ role: asset.role, file: asset.file, bytes: asset.bytes, sha256: asset.sha256, status: 'already-verified' }); continue; }
    }
    const temporary = path.join(output, `.motion-assemble-${asset.role}-${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o644);
    let bytes = 0; const whole = crypto.createHash('sha256'), started = Date.now();
    try {
      for (const part of asset.parts) {
        if (Date.now() - started >= ASSET_TIMEOUT_MS) throw new Error('Motion assembly asset deadline exceeded');
        const deadline = Math.min(CHUNK_TIMEOUT_MS, ASSET_TIMEOUT_MS - (Date.now() - started));
        const response = await fetchImpl(part.url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(deadline), headers: { Accept: 'application/octet-stream' } });
        if (!response.ok || response.status !== 200 || !response.body) throw new Error(`Motion chunk HTTP ${response.status}`);
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== part.bytes)) { await response.body.cancel(); throw new Error('Motion chunk Content-Length mismatch'); }
        const buffer = Buffer.allocUnsafe(part.bytes); let count = 0;
        for await (const raw of response.body) {
          const incoming = Buffer.from(raw);
          if (count + incoming.length > part.bytes) throw new Error('Motion chunk exceeded expected bytes');
          incoming.copy(buffer, count); count += incoming.length;
        }
        if (count !== part.bytes) throw new Error('Motion chunk truncated');
        if (crypto.createHash('sha256').update(buffer).digest('hex') !== part.sha256) throw new Error('Motion chunk SHA-256 mismatch');
        whole.update(buffer); let offset = 0;
        while (offset < buffer.length) { const wrote = fs.writeSync(fd, buffer, offset, buffer.length - offset); if (wrote <= 0) throw new Error('Motion file write made no progress'); offset += wrote; }
        bytes += count;
      }
      if (bytes !== asset.bytes || whole.digest('hex') !== asset.sha256) throw new Error('Motion whole-file identity mismatch');
      fs.fsyncSync(fd); fs.closeSync(fd);
      noSymlink(root, destination, true); fs.renameSync(temporary, destination);
      results.push({ role: asset.role, file: asset.file, bytes, sha256: asset.sha256, status: 'assembled-verified' });
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.unlinkSync(temporary); } catch (cleanup) { if (cleanup.code !== 'ENOENT') error.message += `; temporary cleanup failed: ${cleanup.code}`; }
      throw error;
    }
  }
  return { schemaVersion: 1, assets: results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assembleMotionMedia({ root: process.argv[2] }).then(receipt => console.log(JSON.stringify(receipt, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
