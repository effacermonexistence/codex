'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROLES = Object.freeze(['large', 'small', 'axiom', 'archive', 'entity']);
const MAX_PART_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 40_000_000;
const HASH = /^[a-f0-9]{64}$/;
function invariant(ok, message) { if (!ok) throw new Error(`Motion delivery: ${message}`); }
function noSymlink(root, target, allowMissing = false) {
  const relative = path.relative(root, target);
  invariant(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'path outside root');
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { invariant(!fs.lstatSync(cursor).isSymbolicLink(), 'symlink rejected'); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
  }
}
function checkedRoot(root) {
  const resolved = path.resolve(root);
  invariant(fs.lstatSync(resolved).isDirectory() && !fs.lstatSync(resolved).isSymbolicLink(), 'root must be a real directory');
  invariant(fs.realpathSync(resolved) === resolved, 'root ancestry must not redirect');
  return resolved;
}
function validateDeliveryManifest(value) {
  invariant(value && value.schemaVersion === 1 && Array.isArray(value.assets) && value.assets.length === 5, 'schemaVersion 1 / exactly five assets required');
  const seen = new Set();
  const assets = value.assets.map(asset => {
    invariant(asset && ROLES.includes(asset.role) && !seen.has(asset.role), 'unknown or duplicate role'); seen.add(asset.role);
    invariant(HASH.test(asset.sha256), 'invalid asset SHA-256');
    invariant(asset.file === `motion-${asset.role}-${asset.sha256.slice(0, 16)}.mp4`, 'noncanonical flat destination');
    invariant(Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= MAX_ASSET_BYTES, 'invalid whole byte count');
    invariant(Array.isArray(asset.parts) && asset.parts.length >= 1 && asset.parts.length <= Math.ceil(MAX_ASSET_BYTES / MAX_PART_BYTES), 'invalid part count');
    const parts = asset.parts.map((part, index) => {
      invariant(part && HASH.test(part.sha256), 'invalid part SHA-256');
      invariant(Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= MAX_PART_BYTES, 'invalid part byte count');
      invariant(index === asset.parts.length - 1 || part.bytes === MAX_PART_BYTES, 'nonfinal part must be exactly 4 MiB');
      const expected = new RegExp(`^https://raw\\.githubusercontent\\.com/effacermonexistence/codex/[a-f0-9]{40}/chunks/offscreen-v1/${asset.role}/${String(index).padStart(3, '0')}\\.bin$`);
      invariant(typeof part.url === 'string' && expected.test(part.url), 'part URL must be exact pinned public GitHub chunk');
      return { url: part.url, bytes: part.bytes, sha256: part.sha256 };
    });
    invariant(parts.reduce((sum, part) => sum + part.bytes, 0) === asset.bytes, 'part byte sum mismatch');
    return { role: asset.role, file: asset.file, bytes: asset.bytes, sha256: asset.sha256, parts };
  });
  return { schemaVersion: 1, assets };
}
function readDeliveryManifest(root) {
  root = checkedRoot(root);
  const filename = path.join(root, 'content', 'public-motion', 'delivery.json'); noSymlink(root, filename);
  const info = fs.lstatSync(filename);
  invariant(info.isFile() && info.size <= 128 * 1024, 'invalid manifest file');
  return validateDeliveryManifest(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
function fileIdentity(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd); invariant(stat.isFile(), 'asset is not a regular file');
    const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    return { bytes: stat.size, sha256: hash.digest('hex'), stat };
  } finally { fs.closeSync(fd); }
}
function parseRange(header, size) {
  if (typeof header !== 'string' || header.length > 200) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const number = text => { const n = Number(text); return Number.isSafeInteger(n) && n >= 0 ? n : NaN; };
  let start, end;
  if (!match[1]) {
    const suffix = number(match[2]); if (!suffix || Number.isNaN(suffix)) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = number(match[1]); end = match[2] ? number(match[2]) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
function createMotionStatic(root) {
  root = checkedRoot(root);
  const manifest = readDeliveryManifest(root), routes = new Map();
  for (const asset of manifest.assets) {
    const filename = path.join(root, 'site', 's', asset.file); noSymlink(root, filename);
    const identity = fileIdentity(filename);
    invariant(identity.bytes === asset.bytes && identity.sha256 === asset.sha256, `local ${asset.role} identity mismatch`);
    routes.set(`/s/${asset.file}`, { ...asset, filename, stat: identity.stat });
  }
  return function handleMotion(req, res, pathname) {
    const asset = routes.get(pathname); if (!asset) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Length': 0 }); res.end(); return true; }
    try {
      noSymlink(root, asset.filename); const stat = fs.lstatSync(asset.filename);
      invariant(stat.isFile() && stat.size === asset.bytes && stat.ino === asset.stat.ino && stat.dev === asset.stat.dev && stat.mtimeMs === asset.stat.mtimeMs && stat.ctimeMs === asset.stat.ctimeMs, 'asset changed after startup verification');
    } catch { res.writeHead(500, { 'Content-Length': 0, 'Cache-Control': 'no-store' }); res.end(); return true; }
    const etag = `"sha256-${asset.sha256}"`;
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
    let range;
    if (req.headers.range !== undefined && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
      range = parseRange(req.headers.range, asset.bytes);
      if (!range) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${asset.bytes}`, 'Content-Length': 0 }); res.end(); return true; }
    }
    if (!range && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    const start = range ? range.start : 0, end = range ? range.end : asset.bytes - 1;
    headers['Content-Length'] = end - start + 1;
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${asset.bytes}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = fs.createReadStream(asset.filename, { start, end, flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return true;
  };
}
module.exports = { createMotionStatic, readDeliveryManifest, validateDeliveryManifest, checkedRoot, noSymlink, fileIdentity, parseRange, MAX_PART_BYTES, MAX_ASSET_BYTES, ROLES };
