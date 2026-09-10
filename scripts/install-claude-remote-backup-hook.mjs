#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [templatePath, destinationPath] = process.argv.slice(2);
if (!templatePath || !destinationPath) {
  console.error("Usage: install-claude-remote-backup-hook.mjs <template> <destination>");
  process.exit(2);
}

function readObject(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return value;
}

const template = readObject(templatePath, {});
const existing = readObject(destinationPath, {});
const merged = {
  ...existing,
  permissions: {
    ...(existing.permissions ?? {}),
    ...(template.permissions ?? {}),
  },
  sandbox: {
    ...(existing.sandbox ?? {}),
    ...(template.sandbox ?? {}),
  },
  hooks: { ...(existing.hooks ?? {}) },
};
if (Object.hasOwn(template, "skipDangerousModePermissionPrompt")) {
  merged.skipDangerousModePermissionPrompt = template.skipDangerousModePermissionPrompt;
}
const marker = "remote-backup-guard.mjs";

for (const [eventName, templateGroups] of Object.entries(template.hooks ?? {})) {
  const existingGroups = Array.isArray(merged.hooks[eventName])
    ? merged.hooks[eventName]
    : [];
  const retainedGroups = existingGroups.filter((group) => {
    const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
    return !handlers.some(
      (handler) =>
        typeof handler?.command === "string" && handler.command.includes(marker),
    );
  });
  merged.hooks[eventName] = [...retainedGroups, ...templateGroups];
}

const serialized = `${JSON.stringify(merged, null, 2)}\n`;
const previous = fs.existsSync(destinationPath)
  ? fs.readFileSync(destinationPath, "utf8")
  : null;

fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
if (previous !== null && previous !== serialized) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupPath = `${destinationPath}.before-remote-backup-guard.${timestamp}`;
  fs.copyFileSync(destinationPath, backupPath);
  console.log(`Preserved existing Claude settings: ${backupPath}`);
}

if (previous !== serialized) {
  const temporaryPath = `${destinationPath}.tmp.${process.pid}`;
  fs.writeFileSync(temporaryPath, serialized, { mode: 0o600 });
  fs.renameSync(temporaryPath, destinationPath);
}

const installed = readObject(destinationPath, {});
for (const eventName of ["SessionStart", "Stop", "SessionEnd"]) {
  const groups = Array.isArray(installed.hooks?.[eventName])
    ? installed.hooks[eventName]
    : [];
  const found = groups.some((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).some(
      (handler) =>
        typeof handler?.command === "string" && handler.command.includes(marker),
    ),
  );
  if (!found) throw new Error(`Claude ${eventName} remote backup hook verification failed`);
}
if (template.permissions?.defaultMode !== undefined &&
    installed.permissions?.defaultMode !== template.permissions.defaultMode) {
  throw new Error("Claude default permission mode verification failed");
}
if (template.sandbox?.allowUnsandboxedCommands !== undefined &&
    installed.sandbox?.allowUnsandboxedCommands !== template.sandbox.allowUnsandboxedCommands) {
  throw new Error("Claude sandbox escape-hatch verification failed");
}
