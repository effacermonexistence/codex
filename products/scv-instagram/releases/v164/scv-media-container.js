#!/usr/bin/env node
'use strict'

// Content evidence owns media classification. Instagram voice notes and real
// videos can both arrive with a video/mp4 header, so MIME alone cannot decide
// whether a file should be transcribed. Parse ISO-BMFF handler tracks first:
// `vide` means visible video, while audio-only `soun` is eligible for ASR.

const { spawnSync } = require('child_process')

const SCV_MEDIA_CONTAINER_VERSION =
  'scv-media-container-2026-09-01-v1-track-aware-video-preview'
const ISO_BMFF_CONTAINER_TYPES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta',
  'ilst', 'moof', 'traf', 'mfra'
])
const IMAGE_MAGIC = Object.freeze({
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif'
})

function sniffImageMime(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return IMAGE_MAGIC.JPEG
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) return IMAGE_MAGIC.PNG
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return IMAGE_MAGIC.WEBP
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('ascii'))) {
    return IMAGE_MAGIC.GIF
  }
  return ''
}

function readIsoBox(buffer, offset, end) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 8 > end) return null
  const size32 = buffer.readUInt32BE(offset)
  const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
  let headerBytes = 8
  let size = size32
  if (size32 === 1) {
    if (offset + 16 > end) return null
    const size64 = buffer.readBigUInt64BE(offset + 8)
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(size64)
    headerBytes = 16
  } else if (size32 === 0) {
    size = end - offset
  }
  if (size < headerBytes || offset + size > end) return null
  return { offset, type, size, headerBytes, end: offset + size }
}

function inspectIsoBmffTracks(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const handlers = new Set()
  let boxes = 0

  const walk = (start, end, depth) => {
    if (depth > 10 || boxes > 5000) return
    let offset = start
    while (offset + 8 <= end && boxes <= 5000) {
      const box = readIsoBox(buf, offset, end)
      if (!box) break
      boxes += 1
      if (box.type === 'hdlr' && box.offset + box.headerBytes + 12 <= box.end) {
        const handler = buf
          .subarray(box.offset + box.headerBytes + 8, box.offset + box.headerBytes + 12)
          .toString('ascii')
        if (/^[\x20-\x7e]{4}$/.test(handler)) handlers.add(handler)
      }
      if (ISO_BMFF_CONTAINER_TYPES.has(box.type)) {
        // `meta` is a FullBox and carries four version/flags bytes before children.
        const childStart = box.offset + box.headerBytes + (box.type === 'meta' ? 4 : 0)
        if (childStart < box.end) walk(childStart, box.end, depth + 1)
      }
      offset = box.end
    }
  }

  walk(0, buf.length, 0)
  return {
    is_iso_bmff: buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp',
    handlers: Array.from(handlers).sort(),
    has_video_track: handlers.has('vide'),
    has_audio_track: handlers.has('soun'),
    boxes_scanned: boxes
  }
}

function classifyDownloadedMedia(buffer, mime = '', declaredType = '') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const headerMime = String(mime || '').split(';')[0].trim().toLowerCase()
  const declared = String(declaredType || '').trim().toLowerCase()
  const imageMime = sniffImageMime(buf)
  if (imageMime) {
    return { kind: 'image', mime: imageMime, evidence: 'image_magic' }
  }

  const iso = inspectIsoBmffTracks(buf)
  if (iso.is_iso_bmff || /^(?:audio|video)\/mp4$/i.test(headerMime)) {
    if (iso.has_video_track) {
      return { kind: 'video', mime: 'video/mp4', evidence: 'iso_bmff_vide_track', iso }
    }
    if (iso.has_audio_track) {
      return { kind: 'audio', mime: headerMime || 'audio/mp4', evidence: 'iso_bmff_audio_only', iso }
    }
    return { kind: 'unknown', mime: headerMime || 'application/octet-stream', evidence: 'iso_bmff_no_supported_handler', iso }
  }

  if (/^image\/(?:jpeg|png|webp|gif)$/i.test(headerMime)) {
    return { kind: 'image', mime: headerMime, evidence: 'trusted_image_header' }
  }
  if (/^audio\//i.test(headerMime) || declared === 'voice' || declared === 'audio') {
    return { kind: 'audio', mime: headerMime || 'audio/mp4', evidence: 'audio_declaration' }
  }
  if (/^video\//i.test(headerMime) || declared === 'video' || declared === 'reel') {
    return { kind: 'video', mime: headerMime || 'video/mp4', evidence: 'video_declaration' }
  }
  return { kind: 'unknown', mime: headerMime || 'application/octet-stream', evidence: 'unsupported_content' }
}

function extractVideoPreviewFrame(buffer, options = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const command = String(options.command || process.env.SCV_FFMPEG_BIN || 'ffmpeg')
  const timeout = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || 15000))
  const maxBuffer = Math.max(1024 * 1024, Math.min(8 * 1024 * 1024, Number(options.maxBytes) || 6 * 1024 * 1024))
  const spawnImpl = typeof options.spawnSyncImpl === 'function' ? options.spawnSyncImpl : spawnSync
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vf', 'thumbnail=60,scale=1280:-2:force_original_aspect_ratio=decrease',
    '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
  ]
  const result = spawnImpl(command, args, {
    input: buf,
    encoding: null,
    timeout,
    maxBuffer,
    windowsHide: true
  })
  const stdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.from(result?.stdout || [])
  if (result?.status !== 0 || sniffImageMime(stdout) !== 'image/jpeg') {
    return {
      ok: false,
      reason: result?.error?.code === 'ENOENT'
        ? 'ffmpeg_unavailable'
        : (result?.signal ? 'ffmpeg_timeout_or_signal' : 'ffmpeg_extract_failed'),
      status: Number.isInteger(result?.status) ? result.status : null,
      bytes: stdout.length
    }
  }
  return { ok: true, mime: 'image/jpeg', frame: stdout, bytes: stdout.length }
}

module.exports = {
  SCV_MEDIA_CONTAINER_VERSION,
  sniffImageMime,
  readIsoBox,
  inspectIsoBmffTracks,
  classifyDownloadedMedia,
  extractVideoPreviewFrame
}
