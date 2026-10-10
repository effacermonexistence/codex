#!/usr/bin/env python3
"""Reproduce OS-1's isolated, tool-free OpenClaw/Ollama router installation.

Inspection is the default. --apply is explicit; it never starts a Gateway,
pulls a model, invokes inference, imports an authentication cache, or changes
global npm/CLI/app settings. The config template must be the exact template
validated against the pinned installed CLI, not an inferred schema.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request


VERSION = "2026.9.9"
PACKAGE = "openclaw"
REPOSITORY = "git+https://github.com/openclaw/openclaw.git"
REGISTRY = f"https://registry.npmjs.org/{PACKAGE}/{VERSION}"
TARBALL = f"https://registry.npmjs.org/{PACKAGE}/-/{PACKAGE}-{VERSION}.tgz"
INTEGRITY = "sha512-3sB6ejq5smBozfBhVEDfK48wFpbkx+0f6PJ19qZjC3ab3RoFrYO58CnE2mAsbUy8sXdxdBtjQ3vkAqcW9BZXAw=="
OLLAMA = "http://127.0.0.1:11434"
OWNER = "os1-openclaw-local-router-v1"
DEFAULT_MODEL = "qwen3.5:4b"
DEFAULT_MODEL_DIGEST = "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04"
WORKSPACE_PLACEHOLDER = "__OS1_LOCAL_ROUTER_WORKSPACE__"
LIFECYCLE_SHA256 = {
    "preinstall-package-manager-warning.mjs": "644fe3f8e80eba51b296ed406e546d65474d8f5d2bf2d34615ad6487881d4c9b",
    "postinstall-bundled-plugins.mjs": "46f51eda38ca5342ae2fdb0c902f0f42a2047abc785bbf8252c4fc42ff4b3e68",
}


class SetupFailure(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_json(url: str):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=20) as response:
        if response.geturl() != url:
            raise SetupFailure("Unexpected endpoint redirect")
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise SetupFailure("Metadata exceeds the bounded response size")
    return json.loads(data)


def parse_version(text: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", text.strip())
    if not match:
        raise SetupFailure("Runtime did not return an exact version")
    return tuple(int(value) for value in match.groups())


def supported_node(version: tuple[int, int, int]) -> bool:
    return (version[0] == 24 and version >= (24, 16, 0)) or version >= (26, 1, 0)


def normalize_digest(value: str) -> str:
    result = value.removeprefix("sha256:").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise SetupFailure("The selected model requires an exact SHA-256 digest")
    return result


def check_model(model: str, expected: str | None) -> dict:
    if not model or ":cloud" in model or model.startswith("ollama-cloud/"):
        raise SetupFailure("Only an explicit local Ollama model is allowed")
    listing = fetch_json(OLLAMA + "/api/tags")
    matches = [entry for entry in listing.get("models", [])
               if model in (entry.get("name"), entry.get("model"))]
    if len(matches) != 1:
        raise SetupFailure("The exact selected local model is missing or ambiguous; no model was pulled")
    digest = normalize_digest(matches[0].get("digest", ""))
    if expected is not None and digest != normalize_digest(expected):
        raise SetupFailure("Installed model digest differs from the recovery contract")
    return {"model": model, "digest": digest, "bytes": matches[0].get("size"),
            "endpoint": OLLAMA, "inference_executed": False}


def checked_template(path: Path, model: str, workspace: Path | None = None) -> tuple[bytes, dict]:
    data = path.read_bytes()
    if len(data) > 131072:
        raise SetupFailure("Config template exceeds 128 KiB")
    cfg = json.loads(data)
    providers = cfg.get("models", {}).get("providers", {})
    if set(providers) != {"ollama"}:
        raise SetupFailure("Template must declare only the Ollama provider")
    provider = providers["ollama"]
    if provider.get("baseUrl") != OLLAMA or provider.get("api") != "ollama":
        raise SetupFailure("Template must use the exact local native Ollama endpoint")
    if set(provider) - {"baseUrl", "apiKey", "api", "agentRuntime", "models"}:
        raise SetupFailure("Provider overrides are outside the validated local-only config surface")
    if provider.get("apiKey") not in (None, "ollama-local"):
        raise SetupFailure("A provider credential is not allowed in the local-only template")
    if provider.get("agentRuntime", {}).get("id") != "openclaw":
        raise SetupFailure("Template must explicitly select the OpenClaw provider runtime")
    defaults = cfg.get("agents", {}).get("defaults", {})
    if defaults.get("workspace") == WORKSPACE_PLACEHOLDER:
        if workspace is None:
            raise SetupFailure("The portable template requires an explicitly owned router workspace")
        defaults["workspace"] = str(workspace)
        data = (json.dumps(cfg, indent=2) + "\n").encode()
    elif workspace is not None and defaults.get("workspace") != str(workspace):
        raise SetupFailure("Template workspace does not match this router's owned workspace")
    selection = defaults.get("model")
    primary = selection if isinstance(selection, str) else (selection or {}).get("primary")
    if primary != "ollama/" + model:
        raise SetupFailure("Template model does not match the selected installed model")
    if isinstance(selection, dict) and selection.get("fallbacks"):
        raise SetupFailure("Model fallbacks are forbidden for this local router")
    if cfg.get("agents", {}).get("entries"):
        raise SetupFailure("Additional agents are outside the local router scope")
    tools = cfg.get("tools", {})
    if "*" not in tools.get("deny", []):
        raise SetupFailure("Template must deny every model-visible tool")
    plugins = cfg.get("plugins", {})
    if plugins and plugins.get("allow") != ["ollama"]:
        raise SetupFailure("An explicit plugin config may select only the bundled Ollama provider")
    if cfg.get("auth"):
        raise SetupFailure("Provider authentication profiles are not part of this router template")
    if cfg.get("channels") or cfg.get("hooks", {}).get("enabled"):
        raise SetupFailure("Channels and hooks must not be enabled")
    env = cfg.get("env", {})
    if set(env) - {"shellEnv"} or env.get("shellEnv", {}).get("enabled"):
        raise SetupFailure("Template must not import shell credentials or environment secrets")
    if cfg.get("browser", {}).get("enabled"):
        raise SetupFailure("Browser control must not be enabled")
    return data, cfg


def isolated_env(node: Path, runtime_home: Path, state: Path, config: Path) -> dict:
    # Deliberately do not inherit the operator's API keys, OAuth values, shell
    # customization, NODE_OPTIONS, npmrc settings, or CLI authentication paths.
    return {
        "PATH": str(node.parent) + ":/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(runtime_home), "LANG": "en_US.UTF-8",
        "OPENCLAW_HOME": str(runtime_home), "OPENCLAW_STATE_DIR": str(state),
        "OPENCLAW_CONFIG_PATH": str(config), "OPENCLAW_LOAD_SHELL_ENV": "0",
        # npm 11 rejects one file loaded as both user and global config.
        # Distinct owner-private empty files also prevent inherited npmrc auth.
        "npm_config_userconfig": str(runtime_home / "npm-user.npmrc"),
        "npm_config_globalconfig": str(runtime_home / "npm-global.npmrc"),
        "npm_config_cache": str(runtime_home / "npm-cache"),
    }


def command(arguments: list[str], env: dict, cwd: Path, timeout: int = 30) -> str:
    completed = subprocess.run(arguments, cwd=cwd, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if completed.returncode:
        # Never surface incidental CLI diagnostics containing tokens/config.
        raise SetupFailure(f"Command failed with exit {completed.returncode}; "
                           f"stdout_sha256={sha256(completed.stdout.encode())}; "
                           f"stderr_sha256={sha256(completed.stderr.encode())}")
    return completed.stdout


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise SetupFailure("Refusing a symlinked state file")
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def package_info(prefix: Path) -> dict | None:
    candidates = [prefix / "node_modules/openclaw", prefix / "lib/node_modules/openclaw"]
    found = [candidate for candidate in candidates if (candidate / "package.json").exists()]
    if not found:
        return None
    if len(found) != 1:
        raise SetupFailure("Multiple package owners exist under the private prefix")
    root = found[0]
    manifest = root / "package.json"
    value = read_json(manifest)
    repo = value.get("repository", {})
    repository = repo.get("url") if isinstance(repo, dict) else repo
    if value.get("name") != PACKAGE or value.get("version") != VERSION or repository != REPOSITORY:
        raise SetupFailure("An unrelated or different package already owns the installation prefix")
    entry = root / "openclaw.mjs"
    if not entry.is_file() or not entry.resolve().is_relative_to(prefix.resolve()):
        raise SetupFailure("Installed CLI identity is missing or escapes its private prefix")
    if (root / ".openclaw-lifecycle-pending").exists():
        raise SetupFailure("Installed package lifecycle has not completed")
    for name, expected in LIFECYCLE_SHA256.items():
        script = root / "scripts" / name
        if not script.is_file() or sha256(script.read_bytes()) != expected:
            raise SetupFailure("Installed OpenClaw lifecycle script differs from the reviewed pinned source")
    return {"name": PACKAGE, "version": VERSION, "repository": repository,
            "entry": str(entry), "entry_sha256": sha256(entry.read_bytes()),
            "layout": "local" if root == candidates[0] else "global",
            "package_json_sha256": sha256(manifest.read_bytes())}


def verify_archive(path: Path) -> str:
    hasher = hashlib.sha512()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    actual = "sha512-" + base64.b64encode(hasher.digest()).decode()
    if actual != INTEGRITY:
        raise SetupFailure("OpenClaw archive does not match the pinned registry integrity")
    return actual


def checked_dependency_lock(package_file: Path, lock_file: Path) -> tuple[bytes, bytes]:
    """Require a portable, integrity-pinned npm graph, not a machine-local lock."""
    package_bytes, lock_bytes = package_file.read_bytes(), lock_file.read_bytes()
    if len(package_bytes) > 4096 or len(lock_bytes) > 2_000_000:
        raise SetupFailure("OpenClaw dependency contract exceeds its size bound")
    package, lock = json.loads(package_bytes), json.loads(lock_bytes)
    root = lock.get("packages", {}).get("", {})
    if (package.get("private") is not True or package.get("dependencies") != {PACKAGE: TARBALL}
            or lock.get("lockfileVersion") != 3
            or package.get("name") != lock.get("name") or package.get("version") != lock.get("version")
            or package.get("name") != root.get("name") or package.get("version") != root.get("version")
            or root.get("dependencies") != {PACKAGE: TARBALL}):
        raise SetupFailure("OpenClaw dependency contract does not pin the public package")
    entries = lock["packages"]
    entry = entries.get("node_modules/openclaw", {})
    if (entry.get("version") != VERSION or entry.get("resolved") != TARBALL
            or entry.get("integrity") != INTEGRITY):
        raise SetupFailure("OpenClaw dependency lock has another package identity")
    for name, dependency in entries.items():
        resolved = dependency.get("resolved")
        if not resolved:
            continue
        if not isinstance(resolved, str) or not resolved.startswith("https://registry.npmjs.org/"):
            raise SetupFailure(f"Non-registry dependency in pinned lock: {name}")
        if not isinstance(dependency.get("integrity"), str) or not dependency["integrity"].startswith("sha512-"):
            raise SetupFailure(f"Dependency lacks SHA-512 integrity: {name}")
    return package_bytes, lock_bytes


def acquire_archive(path: Path):
    if path.exists():
        verify_archive(path)
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".openclaw-download-", dir=path.parent)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(TARBALL, timeout=60) as response, os.fdopen(fd, "wb") as stream:
            if response.geturl() != TARBALL:
                raise SetupFailure("Unexpected package archive redirect")
            total = 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > 256 * 1024 * 1024:
                    raise SetupFailure("Package archive exceeds the bounded download size")
                stream.write(block)
        verify_archive(Path(temporary))
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Install/configure only within private paths")
    modes.add_argument("--verify-only", action="store_true", help="Verify existing private installation/config")
    parser.add_argument("--root", type=Path, default=Path.home() / ".os1/local-router")
    parser.add_argument("--prefix", type=Path,
                        default=Path.home() / "Library/Application Support/OS-1/tools" / ("openclaw-" + VERSION))
    parser.add_argument("--node", type=Path, default=Path.home() / ".local/share/node-v24.20.0/bin/node")
    parser.add_argument("--npm", type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--expected-model-digest", default=DEFAULT_MODEL_DIGEST)
    parser.add_argument("--config-template", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "products/os1-mac-runtime/Resources/local-router-config.template.json")
    parser.add_argument("--tarball", type=Path, help="An existing pinned archive for offline recovery")
    parser.add_argument("--dependency-package", type=Path, help="Pinned portable npm package.json")
    parser.add_argument("--dependency-lock", type=Path, help="Pinned portable package-lock.json")
    args = parser.parse_args(argv)
    root = args.root.expanduser().resolve()
    prefix = args.prefix.expanduser().resolve()
    node = args.node.expanduser().resolve()
    npm = (args.npm or node.parent / "npm").expanduser().resolve()
    if root in (Path("/"), Path.home().resolve()) or prefix == Path.home().resolve():
        raise SetupFailure("A dedicated installation/state root is required")
    if prefix.name != "openclaw-" + VERSION:
        raise SetupFailure("Install prefix must be the dedicated version-named OpenClaw directory")
    for original in (args.root.expanduser(), args.prefix.expanduser()):
        if original.is_symlink():
            raise SetupFailure("Installation/state roots must not be symlinks")
    runtime_home, state, config = root / "runtime-home", root / "state", root / "config.json"
    env = isolated_env(node, runtime_home, state, config)
    cwd = root if root.is_dir() else Path(tempfile.gettempdir())
    node_version = command([str(node), "--version"], env, cwd).strip()
    if not supported_node(parse_version(node_version)):
        raise SetupFailure("Pinned OpenClaw requires supported Node 24.16+ or 26.1+")
    model = check_model(args.model, args.expected_model_digest)
    installed = package_info(prefix)
    receipt = {"schema": 1, "owner": OWNER, "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "mode": "inspect", "node": str(node), "node_version": node_version,
               "prefix": str(prefix), "state_root": str(state), "model": model,
               "package": installed, "config_path": str(config), "inference_executed": False,
               "gateway_started": False, "computer_control_enabled": False,
               "provider_authentication_copied": False, "handy_accessed": False}
    if not (args.apply or args.verify_only):
        receipt["config_present"] = config.is_file()
        print(json.dumps(receipt, indent=2))
        return 0
    if args.config_template is None or args.expected_model_digest is None:
        raise SetupFailure("Activation requires --config-template and --expected-model-digest")
    data, _ = checked_template(args.config_template.expanduser().resolve(), args.model, root / "workspace")
    receipt["config_sha256"] = sha256(data)
    marker = root / "installation-owner.json"
    if marker.exists() and read_json(marker).get("owner") != OWNER:
        raise SetupFailure("An unrelated owner controls the private state directory")
    if config.exists() and config.read_bytes() != data:
        raise SetupFailure("Existing config differs; preserve it and supply an explicit migration, not overwrite")
    if args.apply:
        for directory in (root, runtime_home, state, prefix):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in ("npm-user.npmrc", "npm-global.npmrc"):
            path = runtime_home / name
            if not path.exists():
                atomic_write(path, b"")
            elif path.is_symlink() or path.read_bytes() != b"":
                raise SetupFailure("Private npm config is not empty")
        registry = fetch_json(REGISTRY)
        if (registry.get("name") != PACKAGE or registry.get("version") != VERSION
                or registry.get("repository", {}).get("url") != REPOSITORY
                or registry.get("dist", {}).get("integrity") != INTEGRITY
                or registry.get("dist", {}).get("tarball") != TARBALL):
            raise SetupFailure("Registry metadata differs from the pinned recovery contract")
        archive = (args.tarball or root / "recovery" / (PACKAGE + "-" + VERSION + ".tgz")).expanduser().resolve()
        if args.tarball is None:
            acquire_archive(archive)
        receipt["archive_integrity"] = verify_archive(archive)
        receipt["archive_path"] = str(archive)
        if installed is None:
            if args.dependency_package is None or args.dependency_lock is None:
                raise SetupFailure("First install requires a portable pinned dependency graph")
            package_bytes, lock_bytes = checked_dependency_lock(
                args.dependency_package.expanduser().resolve(), args.dependency_lock.expanduser().resolve())
            atomic_write(prefix / "package.json", package_bytes)
            atomic_write(prefix / "package-lock.json", lock_bytes)
            npm_version = parse_version(command([str(node), str(npm), "--version"], env, root).strip())
            # Match the observed private local install. Third-party dependency
            # lifecycles are not authorized. Run only the two reviewed and
            # hash-bound OpenClaw lifecycle entries ourselves afterward.
            # npm 11 interprets `--prefix` as the project identity and then
            # demands a lock entry for that machine-specific directory name.
            # Run in the exact pinned project directory instead.
            call = [str(node), str(npm), "ci", "--ignore-scripts", "--no-audit", "--no-fund"]
            command(call, env, prefix, timeout=1200)
            package_root = prefix / "node_modules/openclaw"
            for name, expected in LIFECYCLE_SHA256.items():
                lifecycle = package_root / "scripts" / name
                if sha256(lifecycle.read_bytes()) != expected:
                    raise SetupFailure("Downloaded lifecycle differs from the reviewed pinned source")
                command([str(node), str(lifecycle)], env, package_root, timeout=120)
            receipt["npm_version"] = ".".join(map(str, npm_version))
            receipt["lifecycle_executed"] = list(LIFECYCLE_SHA256)
            installed = package_info(prefix)
            if installed is None:
                raise SetupFailure("Pinned package was not installed")
        if not config.exists():
            atomic_write(config, data)
        receipt["mode"] = "apply"
    elif installed is None or not config.is_file():
        raise SetupFailure("No existing package/config to verify")
    else:
        receipt["mode"] = "verify-only"
    cli = installed["entry"]
    actual_version = command([str(node), cli, "--version"], env, root).strip()
    if not re.fullmatch(r"OpenClaw\s+" + re.escape(VERSION) + r"(?:\s+\(?[0-9a-f]{7,40}\)?)?", actual_version):
        raise SetupFailure("Installed CLI reports another version")
    command([str(node), cli, "config", "validate", "--json"], env, root, timeout=60)
    activation = {"enabled": True, "openclaw_version": VERSION, "model": args.model,
                  "model_digest": normalize_digest(args.expected_model_digest),
                  "entry_sha256": installed["entry_sha256"], "config_sha256": sha256(data)}
    if args.dependency_package is not None and args.dependency_lock is not None:
        package_bytes, lock_bytes = checked_dependency_lock(
            args.dependency_package.expanduser().resolve(), args.dependency_lock.expanduser().resolve())
        # A verified pre-existing v0 install must not be relabelled v1 merely
        # because the caller supplied signed dependency files. The managed
        # private prefix must actually contain those exact bytes before the
        # v1 activation is written or reported as verified.
        if ((prefix / "package.json").is_symlink() or (prefix / "package-lock.json").is_symlink() or
                not (prefix / "package.json").is_file() or not (prefix / "package-lock.json").is_file() or
                (prefix / "package.json").read_bytes() != package_bytes or
                (prefix / "package-lock.json").read_bytes() != lock_bytes):
            raise SetupFailure("Managed dependency graph does not match the requested v1 activation")
        activation.update({"provisioning_version": 1, "node_sha256": sha256(node.read_bytes()),
                           "dependency_package_sha256": sha256(package_bytes),
                           "dependency_lock_sha256": sha256(lock_bytes),
                           "ollama_version": "0.35.1"})
    activation_path = root / "manifest.json"
    if activation_path.exists():
        previous_activation = read_json(activation_path)
        if any(previous_activation.get(key) != value for key, value in activation.items()):
            raise SetupFailure("Activation manifest differs; preserve it instead of silently reactivating another state")
    elif args.verify_only:
        raise SetupFailure("The checked activation manifest has not been written")
    receipt.update({"package": installed, "cli_version": actual_version, "config_validated": True,
                    "model": check_model(args.model, args.expected_model_digest),
                    "activation_manifest": activation, "activation_manifest_path": str(activation_path),
                    "recovery_scope": "pinned_package_config_model_identity; no_inference_or_quality_claim"})
    if args.apply:
        atomic_write(activation_path, (json.dumps(activation, indent=2) + "\n").encode())
        atomic_write(marker, (json.dumps({"owner": OWNER, "prefix": str(prefix),
                     "config_sha256": sha256(data)}, indent=2) + "\n").encode())
        atomic_write(root / "recovery/setup-receipt.json", (json.dumps(receipt, indent=2) + "\n").encode())
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SetupFailure, OSError, ValueError, subprocess.TimeoutExpired) as error:
        # No raw command output, environment, prompt, or credentials are printed.
        print(json.dumps({"ok": False, "error": str(error), "inference_executed": False}), file=sys.stderr)
        raise SystemExit(1)
