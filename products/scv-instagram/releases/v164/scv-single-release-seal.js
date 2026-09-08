#!/usr/bin/env node
'use strict'

// Local-only deterministic descriptor writer. It accepts public release/target
// identifiers only; no provider credential or secret is read or written.

const fs = require('fs')
const path = require('path')
const {
  SCV_SINGLE_RELEASE_FILE,
  buildSingleReleaseDescriptor,
  descriptorStructureFailures
} = require('./scv-single-release.js')

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--') || index + 1 >= argv.length) {
      throw new Error(`single_release_seal_argument_invalid:${key}`)
    }
    values[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return values
}

function required(values, key) {
  const value = String(values[key] || '').trim()
  if (!value) throw new Error(`single_release_seal_argument_missing:${key}`)
  return value
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writeDescriptorAtomic(file, descriptor) {
  const directory = path.dirname(file)
  const bytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`, 'utf8')
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`)
  const fd = fs.openSync(temp, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temp, file)
  fsyncDirectory(directory)
  return bytes.length
}

function sealFromArguments(values, root = __dirname) {
  const descriptor = buildSingleReleaseDescriptor({
    root,
    releaseId: required(values, 'release-id'),
    projectId: required(values, 'project-id'),
    productionEnvironmentId: required(values, 'production-environment-id'),
    productionServiceId: required(values, 'production-service-id'),
    stagingEnvironmentId: required(values, 'staging-environment-id'),
    stagingServiceId: required(values, 'staging-service-id'),
    productionNamespace: required(values, 'production-namespace'),
    stagingNamespace: required(values, 'staging-namespace'),
    createdAt: values['created-at'] ? new Date(values['created-at']) : new Date()
  })
  const failures = descriptorStructureFailures(descriptor)
  if (failures.length) {
    throw new Error(`single_release_descriptor_rejected:${failures.join(',')}`)
  }
  const output = path.join(root, SCV_SINGLE_RELEASE_FILE)
  const bytes = writeDescriptorAtomic(output, descriptor)
  return {
    ok: true,
    file: SCV_SINGLE_RELEASE_FILE,
    release_id: descriptor.release_id,
    content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
    files: descriptor.files.length,
    bytes,
    raw_values_included: false,
    secret_values_included: false
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(
      sealFromArguments(parseArguments(process.argv.slice(2))), null, 2
    )}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.message || error).slice(0, 2000)
    })}\n`)
    process.exit(1)
  }
}

module.exports = {
  parseArguments,
  writeDescriptorAtomic,
  sealFromArguments
}
