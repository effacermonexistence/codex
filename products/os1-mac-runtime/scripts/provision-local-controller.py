#!/usr/bin/env python3
"""Provision OS-1's pinned local controller on first launch, without credentials.

This is a verified first-run fetch, NOT an offline model bundle. No inference,
hosted provider, browser, user login or other application's state is used.
`--verify-contract-only` performs no network, subprocess, or HOME mutation.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import posixpath
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


class ProvisionFailure(Exception):
    pass


def setup_path(resources: Path) -> Path:
    packaged = resources / "setup-os1-openclaw-local-router.py"
    if packaged.is_file():
        return packaged
    source = Path(__file__).resolve().parents[3] / "scripts/setup-os1-openclaw-local-router.py"
    if source.is_file() and resources == Path(__file__).resolve().parents[1] / "Resources":
        return source
    raise ProvisionFailure("pinned_setup_helper_missing")


def read_contract(resources: Path) -> dict:
    resources = resources.resolve()
    path = resources / "local-controller-sources.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    if (contract["schema"] != 1 or contract["delivery"] != "verified-first-run-fetch-not-offline-bundle"
            or contract["controller"]["name"] != "openclaw"
            or contract["controller"]["version"] != "2026.9.9"
            or contract["model"]["name"] != "qwen3.5:4b"
            or re.fullmatch(r"[0-9a-f]{64}", contract["model"]["digest"]) is None):
        raise ProvisionFailure("source_contract_identity_mismatch")
    for arch in ("arm64", "x86_64"):
        if (re.fullmatch(r"[0-9a-f]{64}", contract["node"][arch]["sha256"]) is None
                or not contract["node"][arch]["url"].startswith("https://nodejs.org/dist/v24.20.0/")):
            raise ProvisionFailure("source_contract_node_identity_mismatch")
    if (contract["ollama"]["url"] != "https://github.com/ollama/ollama/releases/download/v0.35.1/ollama-darwin.tgz"
            or re.fullmatch(r"[0-9a-f]{64}", contract["ollama"]["sha256"]) is None):
        raise ProvisionFailure("source_contract_ollama_identity_mismatch")
    setup = setup_path(resources)
    spec = importlib.util.spec_from_file_location("os1_controller_setup", setup)
    module = importlib.util.module_from_spec(spec)
    if spec.loader is None:
        raise ProvisionFailure("pinned_setup_helper_unloadable")
    spec.loader.exec_module(module)
    module.checked_dependency_lock(resources / "local-controller-package.json",
                                   resources / "local-controller-package-lock.json")
    module.checked_template(resources / "local-router-config.template.json",
                            contract["model"]["name"], Path.home() / ".os1/local-router/workspace")
    return contract


def status(root: Path, phase: str, reason: str = "", **fields):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = {"schema": 1, "phase": phase, "reason": reason,
               "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "delivery": "verified-first-run-fetch-not-offline-bundle", **fields}
    temporary = root / (".status.%d.json" % os.getpid())
    temporary.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(root / "provision-status.json")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download_exact(url: str, destination: Path, digest: str, max_size: int) -> Path:
    if destination.exists():
        if destination.is_symlink() or sha256_file(destination) != digest:
            raise ProvisionFailure("cached_archive_identity_mismatch")
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary_name = tempfile.mkstemp(prefix=".os1-download-", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as output, urllib.request.urlopen(url, timeout=120) as response:
            if not response.geturl().startswith("https://"):
                raise ProvisionFailure("download_redirect_not_https")
            h = hashlib.sha256(); size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > max_size:
                    raise ProvisionFailure("download_exceeds_bound")
                h.update(block); output.write(block)
            output.flush(); os.fsync(output.fileno())
        if h.hexdigest() != digest:
            raise ProvisionFailure("download_digest_mismatch")
        temporary.chmod(0o600)
        temporary.replace(destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def extract_checked(archive: Path, target: Path, strip: int = 0):
    """Extract only ordinary files, directories and internal links."""
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 20_000:
            raise ProvisionFailure("archive_member_count_exceeded")
        for item in members:
            parts = PurePosixPath(item.name).parts
            if (item.name.startswith("/") or ".." in parts or len(parts) < strip):
                raise ProvisionFailure("unsafe_archive_path")
            parts = parts[strip:]
            if not parts:
                continue
            relative = PurePosixPath(*parts)
            place = target.joinpath(*parts)
            if item.isdir():
                place.mkdir(parents=True, exist_ok=True)
            elif item.isfile():
                if item.size > 250_000_000:
                    raise ProvisionFailure("archive_member_exceeds_bound")
                place.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(item)
                if source is None:
                    raise ProvisionFailure("archive_member_unreadable")
                with source, place.open("xb") as output:
                    shutil.copyfileobj(source, output)
                place.chmod(item.mode & 0o755)
            elif item.issym():
                link = PurePosixPath(item.linkname)
                normalized = posixpath.normpath(posixpath.join(str(relative.parent), item.linkname))
                if item.linkname.startswith("/") or normalized == ".." or normalized.startswith("../"):
                    raise ProvisionFailure("unsafe_archive_link")
                place.parent.mkdir(parents=True, exist_ok=True)
                place.symlink_to(item.linkname)
                if not place.resolve(strict=False).is_relative_to(target.resolve()):
                    raise ProvisionFailure("archive_link_escapes_target")
            else:
                raise ProvisionFailure("unsupported_archive_member")


def run_checked(args: list[str], env: dict, timeout: int = 60) -> str:
    result = subprocess.run(args, env=env, cwd=str(Path.home()), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # No raw tool output: that could contain input from unrelated runtime state.
        raise ProvisionFailure("runtime_command_failed")
    return result.stdout.decode("utf-8", "replace").strip()


def require_architecture(binary: Path, architecture: str):
    result = subprocess.run(["/usr/bin/lipo", "-archs", str(binary)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=15)
    if result.returncode or architecture not in result.stdout.decode("ascii", "replace").split():
        raise ProvisionFailure("runtime_binary_architecture_mismatch")


def base_environment(root: Path) -> dict:
    return {"HOME": str(root / "runtime-home"), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "LANG": "en_US.UTF-8", "OLLAMA_HOST": "127.0.0.1:11434",
            "OLLAMA_MODELS": str(root / "models"), "OLLAMA_NO_CLOUD": "1"}


def ensure_node(contract: dict, tools: Path, root: Path) -> Path:
    node_root = tools / "node-v24.20.0"
    node = node_root / "bin/node"
    env = base_environment(root)
    if node.exists():
        if run_checked([str(node), "--version"], env) != "v24.20.0":
            raise ProvisionFailure("existing_node_identity_mismatch")
        require_architecture(node, platform.machine())
        return node
    arch = platform.machine()
    if arch not in ("arm64", "x86_64"):
        raise ProvisionFailure("unsupported_macos_architecture")
    pin = contract["node"][arch]
    archive = download_exact(pin["url"], root / "recovery" / ("node-" + arch + ".tar.gz"),
                             pin["sha256"], 80_000_000)
    stage = tools / (".node-v24.20.0.stage.%d" % os.getpid())
    extract_checked(archive, stage, strip=1)
    if run_checked([str(stage / "bin/node"), "--version"], env) != "v24.20.0":
        raise ProvisionFailure("staged_node_identity_mismatch")
    require_architecture(stage / "bin/node", arch)
    if node_root.exists():
        raise ProvisionFailure("node_install_race")
    stage.rename(node_root)
    return node


def loopback_version() -> str | None:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:11434/api/version", timeout=3) as response:
            if response.status != 200:
                return None
            data = response.read(1024)
        return str(json.loads(data).get("version", ""))
    except (OSError, ValueError):
        return None


def model_present(name: str, digest: str) -> bool:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:11434/api/tags", timeout=5) as response:
            if response.status != 200:
                return False
            data = response.read(128_001)
        if len(data) > 128_000:
            return False
        return any(row.get("name") == name and row.get("digest") == digest
                   for row in json.loads(data).get("models", []))
    except (OSError, ValueError):
        return False


def ensure_ollama_model(contract: dict, tools: Path, root: Path):
    version = loopback_version()
    name = contract["model"]["name"]
    digest = contract["model"]["digest"]
    if version is not None:
        if version != contract["ollama"]["version"] or not model_present(name, digest):
            raise ProvisionFailure("occupied_ollama_port_is_not_pinned_sidecar")
        return "compatible_existing_loopback"
    pin = contract["ollama"]
    archive = download_exact(pin["url"], root / "recovery/ollama-darwin-v0.35.1.tgz",
                             pin["sha256"], pin["size"])
    tools.mkdir(parents=True, exist_ok=True, mode=0o700)
    installed = tools / "ollama-v0.35.1"
    if not installed.exists():
        stage = tools / (".ollama-v0.35.1.stage.%d" % os.getpid())
        extract_checked(archive, stage)
        if not (stage / "ollama").is_file():
            raise ProvisionFailure("ollama_archive_has_no_binary")
        stage.rename(installed)
    executable = installed / "ollama"
    if not executable.is_file():
        raise ProvisionFailure("installed_ollama_binary_missing")
    require_architecture(executable, platform.machine())
    env = base_environment(root)
    for folder in (root / "models", root / "runtime-home"):
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    log = root / "ollama-serve.log"
    with log.open("ab") as output:
        log.chmod(0o600)
        subprocess.Popen([str(executable), "serve"], env=env, cwd=installed,
                         stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                         start_new_session=True, close_fds=True)
    for _ in range(60):
        if loopback_version() is not None:
            break
        time.sleep(0.5)
    if loopback_version() != pin["version"]:
        raise ProvisionFailure("pinned_ollama_server_did_not_start")
    if not model_present(name, digest):
        pulled = subprocess.run([str(executable), "pull", name], env=env, cwd=installed,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=3600)
        if pulled.returncode:
            raise ProvisionFailure("public_model_download_failed")
    if not model_present(name, digest):
        raise ProvisionFailure("downloaded_model_digest_mismatch")
    return "managed_local_sidecar"


def ensure_controller(contract: dict, resources: Path, tools: Path, root: Path, node: Path):
    setup = setup_path(resources)
    archive = root / "recovery/openclaw-2026.9.9.tgz"
    result = subprocess.run(["/usr/bin/python3", str(setup), "--apply", "--root", str(root),
                             "--prefix", str(tools / "openclaw-2026.9.9"), "--node", str(node),
                             "--config-template", str(resources / "local-router-config.template.json"),
                             "--dependency-package", str(resources / "local-controller-package.json"),
                             "--dependency-lock", str(resources / "local-controller-package-lock.json"),
                             "--tarball", str(archive)],
                            env=base_environment(root), cwd=resources, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800)
    if result.returncode:
        raise ProvisionFailure("openclaw_setup_rejected")
    receipt = json.loads(result.stdout)
    if receipt.get("model", {}).get("digest") != contract["model"]["digest"]:
        raise ProvisionFailure("openclaw_receipt_model_identity_mismatch")
    return receipt["activation_manifest"]


def write_installed_sbom(contract: dict, tools: Path, root: Path):
    """Record actual fetched packages and their declared licenses after npm ci."""
    prefix = tools / "openclaw-2026.9.9"
    modules = prefix / "node_modules"
    if not modules.is_dir() or modules.is_symlink():
        raise ProvisionFailure("controller_dependency_tree_missing")
    lock_path = prefix / "package-lock.json"
    if not lock_path.is_file() or lock_path.is_symlink():
        raise ProvisionFailure("controller_dependency_lock_missing")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = []
    for relative, locked in sorted(lock.get("packages", {}).items()):
        if not relative:
            continue
        relative_path = PurePosixPath(relative)
        if ".." in relative_path.parts or not relative.startswith("node_modules/"):
            raise ProvisionFailure("controller_sbom_lock_path_invalid")
        manifest = prefix.joinpath(*relative_path.parts) / "package.json"
        if not manifest.exists():
            if locked.get("optional"):
                continue
            raise ProvisionFailure("controller_required_dependency_missing")
        if not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_size > 256_000:
            raise ProvisionFailure("controller_dependency_manifest_invalid")
        row = json.loads(manifest.read_text(encoding="utf-8"))
        license_label = row.get("license")
        if (not isinstance(row.get("name"), str) or not isinstance(row.get("version"), str)
                or row.get("version") != locked.get("version")):
            raise ProvisionFailure("controller_dependency_version_mismatch")
        if not isinstance(license_label, str) or not license_label:
            license_label = "UNKNOWN"
        record = {"name": row["name"], "version": row["version"],
                  "license": license_label, "package_json_sha256": sha256_file(manifest),
                  "lock_integrity": locked.get("integrity")}
        for notice_name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"):
            notice = manifest.parent / notice_name
            if notice.is_file() and not notice.is_symlink() and notice.stat().st_size <= 200_000:
                record["license_file"] = notice_name
                record["license_file_sha256"] = sha256_file(notice)
                break
        packages.append(record)
    if not any(p.get("name") == "openclaw" and p.get("version") == "2026.9.9" for p in packages):
        raise ProvisionFailure("controller_sbom_missing_openclaw")
    document = {"schema": 1, "source": "installed_private_npm_tree_after_integrity_locked_ci",
                "openclaw": contract["controller"]["version"],
                "ollama": contract["ollama"]["version"],
                "node": contract["node"]["version"],
                "model": contract["model"]["name"],
                "model_digest": contract["model"]["digest"],
                "undeclared_license_count": sum(p["license"] == "UNKNOWN" for p in packages),
                "packages": packages}
    destination = root / "recovery/installed-controller-sbom.json"
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name("." + destination.name + ".%d" % os.getpid())
    temporary.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(destination)
    return len(packages), sha256_file(destination)


def legacy_ready(contract: dict, resources: Path, tools: Path, root: Path) -> bool:
    """Preserve a verified earlier install; never rewrite its signed state."""
    marker = root / "manifest.json"
    if not marker.is_file() or marker.is_symlink():
        return False
    try:
        recorded = json.loads(marker.read_text())
        if (recorded.get("provisioning_version") is not None
                or recorded.get("openclaw_version") != contract["controller"]["version"]
                or recorded.get("model_digest") != contract["model"]["digest"]):
            return False
        node = Path.home() / ".local/share/node-v24.20.0/bin/node"
        call = ["/usr/bin/python3", str(setup_path(resources)), "--verify-only",
                "--root", str(root), "--prefix", str(tools / "openclaw-2026.9.9"),
                "--node", str(node), "--config-template",
                str(resources / "local-router-config.template.json")]
        result = subprocess.run(call, env=base_environment(root), cwd=resources,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=60)
        return result.returncode == 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--ensure", action="store_true", help="Fetch and provision the verified local sidecar")
    modes.add_argument("--verify-contract-only", action="store_true", help="Pure read-only fixture")
    parser.add_argument("--resources", type=Path, help="Trusted signed app resource directory")
    args = parser.parse_args()
    resources = (args.resources or (Path(__file__).resolve().parent.parent / "Resources"
                                    if Path(__file__).resolve().parent.name == "scripts"
                                    else Path(__file__).resolve().parent)).resolve()
    contract = read_contract(resources)
    contract_sha256 = sha256_file(resources / "local-controller-sources.json")
    if args.verify_contract_only:
        print(json.dumps({"status": "PASS", "delivery": contract["delivery"],
                          "model": contract["model"]["name"], "model_digest": contract["model"]["digest"],
                          "model_calls": 0, "network_calls": 0}, sort_keys=True))
        return 0
    if sys.platform != "darwin":
        raise ProvisionFailure("macos_required")
    root = Path.home() / ".os1/local-router"
    tools = Path.home() / "Library/Application Support/OS-1/tools"
    if root.is_symlink() or tools.is_symlink():
        raise ProvisionFailure("owned_root_is_symlink")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / "provision.lock").open("a+") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        def mark(phase: str, reason: str = "", **fields):
            status(root, phase, reason, source_contract_sha256=contract_sha256, **fields)
        try:
            mark("provisioning")
            if legacy_ready(contract, resources, tools, root):
                mark("ready", model_digest=contract["model"]["digest"],
                     runtime_mode="legacy_verified_existing", controller_version="2026.9.9",
                     offline_bundle=False, hosted_provider_calls=0)
                return 0
            node = ensure_node(contract, tools, root)
            mark("provisioning", step="local_model")
            mode = ensure_ollama_model(contract, tools, root)
            mark("provisioning", step="openclaw")
            # setup expects an already verified pinned archive. Never use a
            # mutable npm tag, account cache or inherited shell environment.
            url, integrity = contract["controller"]["url"], contract["controller"]["integrity"]
            archive = root / "recovery/openclaw-2026.9.9.tgz"
            if not archive.exists():
                with tempfile.TemporaryDirectory(prefix="os1-controller-") as temporary:
                    pending = Path(temporary) / "openclaw.tgz"
                    with urllib.request.urlopen(url, timeout=120) as response, pending.open("wb") as output:
                        if not response.geturl().startswith("https://"):
                            raise ProvisionFailure("controller_download_redirect_not_https")
                        total = 0
                        while block := response.read(1024 * 1024):
                            total += len(block)
                            if total > 256 * 1024 * 1024:
                                raise ProvisionFailure("controller_archive_exceeds_bound")
                            output.write(block)
                    archive.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    if ("sha512-" + __import__("base64").b64encode(hashlib.sha512(pending.read_bytes()).digest()).decode()) != integrity:
                        raise ProvisionFailure("controller_archive_integrity_mismatch")
                    shutil.copy2(pending, archive)
                    archive.chmod(0o600)
            activation = ensure_controller(contract, resources, tools, root, node)
            package_count, sbom_sha256 = write_installed_sbom(contract, tools, root)
            mark("ready", model_digest=activation["model_digest"], runtime_mode=mode,
                 controller_version=activation["openclaw_version"],
                 offline_bundle=False, hosted_provider_calls=0,
                 installed_package_count=package_count, installed_sbom_sha256=sbom_sha256)
            return 0
        except Exception as error:
            reason = error.args[0] if isinstance(error, ProvisionFailure) else type(error).__name__
            mark("blocked", reason=str(reason)[:100])
            return 1


if __name__ == "__main__":
    sys.exit(main())
