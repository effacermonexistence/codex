#!/usr/bin/env python3
"""Opt-in, zero-model command/exec regression for the qualified macOS SDK.

No arguments (or --help) executes nothing. --self-test is offline. Actual use:
  python3 SCRIPT --execute-zero-turn --native-executable ABS \
    --expected-launcher-sha SHA --expected-backend-sha SHA --output NEW_PRIVATE_ABS

Only initialize, initialized, config/read and command/exec are sent. This tests
standalone sandboxed commands, NOT an LLM tool call, reasoning or quality parity.
The legacy profile must reproduce shared-temp writes; the fixed profile must
deny them while preserving the exact workspace/scratch capabilities. No auth,
model, thread, turn, global configuration, API or external-network operation.

Protocol: https://learn.chatgpt.com/docs/app-server
Profiles: https://learn.chatgpt.com/docs/permissions
Derived from the independently executed Q413 probe_scope_no_model.py canary.
"""
from __future__ import annotations

import argparse
import ctypes
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

LAUNCHER_SHA = "50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8"
BACKEND_SHA = "1afb28c01d7d49e892bd75f11076b10f1451e34e0ee308a95e5ab7f69f9c84fe"
QUALIFIED_VERSION = "codex-cli 0.163.0-alpha.10.2"
METHODS = frozenset(("initialize", "initialized", "config/read", "command/exec"))
TARGETS = frozenset(("workspace", "scratch", "outside", "tmp_alias", "private_tmp"))
ENV_KEYS = ("HOME", "USER", "LOGNAME", "PATH", "LANG", "SHELL")


class Rejected(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise Rejected(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical_absolute(value):
    p = Path(value)
    require(p.is_absolute() and str(p) == value and ".." not in p.parts, "noncanonical_path")
    require(p.resolve() == p, "symlink_or_noncanonical_path")
    return p


def private_directory(p):
    s = p.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid()
            and stat.S_IMODE(s.st_mode) == 0o700 and p.resolve() == p, "private_directory_custody")


def new_output(value):
    p = canonical_absolute(value)
    private_directory(p.parent)
    require(not os.path.lexists(p), "output_already_exists")
    p.mkdir(mode=0o700)
    private_directory(p)
    return p


def pin_file(p, expected):
    canonical_absolute(str(p))
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and before.st_mode & 0o022 == 0 and 0 < before.st_size < 256_000_000,
                "native_file_custody")
        h = hashlib.sha256()
        while chunk := os.read(fd, 1024 * 1024):
            h.update(chunk)
        after, named = os.fstat(fd), p.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        require(identity(before) == identity(after) == identity(named), "native_file_changed")
        require(h.hexdigest() == expected, "native_hash_mismatch")
        return {"path": str(p), "sha256": h.hexdigest(), "bytes": before.st_size}
    finally:
        os.close(fd)


def qualified_tuple(executable, launcher_sha, backend_sha):
    require(launcher_sha == LAUNCHER_SHA and backend_sha == BACKEND_SHA, "unqualified_expected_tuple")
    launcher = canonical_absolute(executable)
    require(launcher.name == "codex" and launcher.parent.name == "bin", "native_launcher_shape")
    backend = launcher.parent.parent / "CodexCLI.app/Contents/MacOS/codex"
    return [pin_file(launcher, LAUNCHER_SHA), pin_file(backend, BACKEND_SHA)]


def darwin_temp():
    # _CS_DARWIN_USER_TEMP_DIR, not the untrusted inherited TMPDIR.
    libc = ctypes.CDLL(None)
    libc.confstr.argtypes = (ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t)
    libc.confstr.restype = ctypes.c_size_t
    n = libc.confstr(65537, None, 0)
    require(1 < n <= 4096, "darwin_temp_unavailable")
    b = ctypes.create_string_buffer(n)
    require(libc.confstr(65537, b, n) == n, "darwin_temp_changed")
    p = Path(os.fsdecode(b.value)).resolve()
    s = p.lstat()
    require(p.is_absolute() and p.name == "T" and stat.S_ISDIR(s.st_mode)
            and s.st_uid == os.getuid() and s.st_mode & 0o022 == 0, "darwin_temp_custody")
    return p


def profile_filesystem(workspace, scratch, mode, fixed):
    require(mode in ("read", "write"), "invalid_workspace_mode")
    fs = {":minimal": "read", str(workspace): mode, str(scratch): "write"}
    if fixed:
        fs[":slash_tmp"] = "deny"
    return fs


def validate_profile(config, name, fs):
    require(isinstance(config, dict) and config.get("default_permissions") == name, "default_profile_ack")
    p = config.get("permissions", {}).get(name)
    require(isinstance(p, dict) and p.get("extends") is None, "named_profile_ack")
    observed = p.get("filesystem")
    require(isinstance(observed, dict), "filesystem_profile_ack")
    require({k: v for k, v in observed.items() if k != "glob_scan_max_depth"} == fs,
            "filesystem_profile_mismatch")
    require(observed.get("glob_scan_max_depth") is None, "unexpected_glob_depth")
    network = p.get("network")
    require(isinstance(network, dict) and network.get("enabled") is False, "network_profile_ack")
    return {"default_permissions": name, "filesystem": observed, "network_enabled": False}


def request(method, ident, params):
    require(method in METHODS, "forbidden_rpc_method")
    value = {"method": method, "params": params}
    if ident is not None:
        value["id"] = ident
    return value


def decode_command(result):
    require(isinstance(result, dict) and result.get("exitCode") == 0, "command_not_successful")
    text = result.get("stdout")
    require(isinstance(text, str) and 0 < len(text.encode()) <= 16000, "command_stdout_absent")
    try:
        value = json.loads(text)
    except (ValueError, TypeError) as e:
        raise Rejected("command_stdout_not_synthetic_json") from e
    require(isinstance(value, dict) and set(value) == TARGETS | {"workspace_read"}, "command_result_shape")
    require(value["workspace_read"] == "read_ok", "workspace_read_positive_control_failed")
    require(all(value[k] in ("allowed", "denied") for k in TARGETS), "unexpected_command_error")
    return value


def expected_result(mode, fixed):
    return {"workspace_read": "read_ok", "workspace": "allowed" if mode == "write" else "denied",
            "scratch": "allowed", "outside": "denied",
            "tmp_alias": "denied" if fixed else "allowed",
            "private_tmp": "denied" if fixed else "allowed"}


def cleanup_exact_file(p, payload):
    """Delete only this run's exact single-link, owned 0600 synthetic bytes."""
    if not os.path.lexists(p):
        return "absent"
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_nlink == 1
                and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size == len(payload), "cleanup_custody_mismatch")
        require(os.read(fd, len(payload) + 1) == payload, "cleanup_hash_mismatch")
        current = p.lstat()
        require((s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns) ==
                (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns), "cleanup_identity_changed")
        p.unlink()
        return "removed_exact_owned_canary"
    finally:
        os.close(fd)


class Stdio:
    def __init__(self, argv, cwd, scratch):
        env = {k: os.environ[k] for k in ENV_KEYS if k in os.environ}
        env.update(TMPDIR=str(scratch), OS1_INTERNAL_PROVIDER_EXECUTION="1")
        self.p = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.p.stdout, selectors.EVENT_READ, "stdout")
        self.selector.register(self.p.stderr, selectors.EVENT_READ, "stderr")
        self.buffer = b""
        self.stderr_hash = hashlib.sha256()
        self.stderr_bytes = 0
        self.deadline = time.monotonic() + 40
        self.sent = []
        self.rejected_host_requests = 0

    def rpc(self, method, ident, params):
        q = request(method, ident, params)
        self.sent.append(q)
        self.p.stdin.write(json.dumps(q).encode() + b"\n")
        self.p.stdin.flush()
        if ident is None:
            return None
        while time.monotonic() < self.deadline:
            for key, _ in self.selector.select(0.25):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    self.selector.unregister(key.fileobj)
                    continue
                if key.data == "stderr":
                    self.stderr_hash.update(chunk)
                    self.stderr_bytes += len(chunk)
                    require(self.stderr_bytes <= 512_000, "stderr_bound")
                    continue
                self.buffer += chunk
                require(len(self.buffer) <= 2_000_000, "stdio_bound")
                while b"\n" in self.buffer:
                    line, self.buffer = self.buffer.split(b"\n", 1)
                    if not line:
                        continue
                    m = json.loads(line)
                    require(isinstance(m, dict), "stdio_nonobject")
                    if "method" in m and "id" in m:
                        self.rejected_host_requests += 1
                        self.p.stdin.write(json.dumps({"id": m["id"], "error": {
                            "code": -32601, "message": "zero-turn canary rejects host requests"}}).encode() + b"\n")
                        self.p.stdin.flush()
                        raise Rejected("unexpected_host_request_denied")
                    if "id" not in m:
                        require(not str(m.get("method", "")).startswith(("thread/", "turn/", "item/")),
                                "unexpected_generation_notification")
                        continue
                    require(type(m["id"]) is int and m["id"] == ident, "unexpected_response_id")
                    require("error" not in m and "result" in m, "rpc_error_or_empty_result")
                    return m["result"]
            require(self.p.poll() is None or self.selector.get_map(), "server_exited_before_response")
        raise Rejected("bounded_rpc_timeout")

    def close(self):
        try:
            self.p.stdin.close()
        except OSError:
            pass
        try:
            self.p.wait(timeout=8)
        except subprocess.TimeoutExpired:
            # The new session belongs only to this script. Never target OS-1,
            # the user's running app-server, or a process found by name.
            if self.p.poll() is None and os.getpgid(self.p.pid) == self.p.pid:
                os.killpg(self.p.pid, signal.SIGTERM)
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                if self.p.poll() is None and os.getpgid(self.p.pid) == self.p.pid:
                    os.killpg(self.p.pid, signal.SIGKILL)
                self.p.wait(timeout=3)
        finally:
            self.selector.close()
            self.p.stdout.close()
            self.p.stderr.close()
        return {"pid": self.p.pid, "terminal": self.p.poll() is not None,
                "exit_code": self.p.returncode, "rejected_host_requests": self.rejected_host_requests,
                "stderr_bytes": self.stderr_bytes, "stderr_sha256": self.stderr_hash.hexdigest()}


def command_program(targets, original, payload):
    # All paths and bytes below are generated by this program, never a prompt.
    return ("import os,json,errno; t=" + repr(targets) + "; initial=" + repr(original) +
            "; payload=" + repr(payload) + "; r={}\n"
            "try:\n r['workspace_read']='read_ok' if open(t['workspace'],'rb').read()==initial else 'wrong_bytes'\n"
            "except Exception:\n r['workspace_read']='read_failed'\n"
            "for k,p in t.items():\n"
            " try:\n"
            "  flags=os.O_WRONLY|os.O_NOFOLLOW|(os.O_APPEND if k=='workspace' else os.O_CREAT|os.O_EXCL)\n"
            "  f=os.open(p,flags,0o600)\n"
            "  try: os.write(f,payload)\n"
            "  finally: os.close(f)\n"
            "  r[k]='allowed'\n"
            " except PermissionError as e: r[k]='denied' if e.errno in (errno.EPERM,errno.EACCES) else 'other_error'\n"
            " except Exception: r[k]='other_error'\n"
            "print(json.dumps(r,sort_keys=True))\n")


def probe(executable, output, temp_root, run_id, mode, fixed):
    label = ("fixed" if fixed else "legacy") + "-" + mode
    folder = output / label
    folder.mkdir(mode=0o700)
    workspace, outside, scratch = folder / "workspace", folder / "outside", temp_root / label
    for p in (workspace, outside, scratch):
        p.mkdir(mode=0o700)
    original = ("OS1_TMP_BOUNDARY_ORIGINAL:" + run_id + ":" + label + "\n").encode()
    payload = ("OS1_TMP_BOUNDARY_APPEND:" + run_id + ":" + label + "\n").encode()
    read_file = workspace / "read-write-canary.txt"
    read_file.write_bytes(original)
    read_file.chmod(0o600)
    stem = "os1-native-tmp-boundary-" + run_id + "-" + label
    targets = {"workspace": str(read_file), "scratch": str(scratch / "write-canary.txt"),
               "outside": str(outside / "write-canary.txt"), "tmp_alias": "/tmp/" + stem + "-alias.txt",
               "private_tmp": "/private/tmp/" + stem + "-canonical.txt"}
    require(all(not os.path.lexists(v) for k, v in targets.items() if k != "workspace"), "canary_target_already_exists")
    name = "os1-tmp-canary-" + run_id[:12] + "-" + label
    fs = profile_filesystem(workspace, scratch, mode, fixed)
    toml = "{" + ",".join(json.dumps(k) + "=" + json.dumps(v) for k, v in fs.items()) + "}"
    argv = [executable, "app-server", "--listen", "stdio://", "-c", "default_permissions=" + json.dumps(name),
            "-c", "permissions." + name + ".filesystem=" + toml,
            "-c", "permissions." + name + ".network.enabled=false"]
    row = {"label": label, "workspace_mode": mode, "slash_tmp_deny": fixed, "status": "FAIL",
           "requests": [], "provider_model_calls": 0, "thread_starts": 0, "turn_starts": 0, "cleanup": {}}
    client = None
    try:
        client = Stdio(argv, workspace, scratch)
        client.rpc("initialize", 1, {"clientInfo": {"name": "os1-zero-turn-tmp-canary", "version": "1"},
                                      "capabilities": {"experimentalApi": True}})
        client.rpc("initialized", None, {})
        config = client.rpc("config/read", 2, {"includeLayers": False})
        row["effective_profile"] = validate_profile(config["config"], name, fs)
        result = client.rpc("command/exec", 3, {"command": ["/usr/bin/python3", "-I", "-S", "-c",
            command_program(targets, original, payload)], "cwd": str(workspace), "env": {"TMPDIR": str(scratch)},
            "permissionProfile": name, "timeoutMs": 10000, "outputBytesCap": 16000})
        actual = decode_command(result)
        row["command_result"] = actual
        row["command_stdout_sha256"] = digest(result["stdout"].encode())
        row["command_stderr_sha256"] = digest(str(result.get("stderr", "")).encode())
        row["expected_result"] = expected_result(mode, fixed)
        require(actual == row["expected_result"], "capability_result_mismatch")
        require(read_file.read_bytes() == original + (payload if mode == "write" else b""),
                "workspace_canary_bytes_changed_unexpectedly")
        for key in TARGETS - {"workspace"}:
            p = Path(targets[key])
            require(p.exists() == (actual[key] == "allowed"), "command_effect_not_observed")
            if p.exists():
                require(p.read_bytes() == payload, "canary_payload_mismatch")
        row["status"] = "PASS_EXPECTED_LEGACY_ESCAPE" if not fixed else "PASS_FIXED_BOUNDARY"
    except Exception as e:
        # Only controlled categories, never arbitrary native/config text.
        row["failure"] = str(e) if isinstance(e, Rejected) else type(e).__name__
    finally:
        if client:
            row["requests"] = client.sent
            row["lifecycle"] = client.close()
        for key in ("tmp_alias", "private_tmp", "scratch"):
            try:
                row["cleanup"][key] = cleanup_exact_file(Path(targets[key]), payload)
            except Exception as e:
                row["cleanup"][key] = "HELD:" + (str(e) if isinstance(e, Rejected) else type(e).__name__)
                row["status"] = "FAIL_CLEANUP_HELD"
        try:
            scratch.rmdir()
        except OSError:
            row["cleanup"]["scratch_directory"] = "HELD_NONEMPTY_OR_CHANGED"
            row["status"] = "FAIL_CLEANUP_HELD"
    return row


def execute(args):
    require(sys.platform == "darwin", "macos_only")
    before = qualified_tuple(args.native_executable, args.expected_launcher_sha, args.expected_backend_sha)
    require(Path("/tmp").resolve() == Path("/private/tmp"), "unexpected_shared_temp_alias")
    output = new_output(args.output)
    run_id = uuid.uuid4().hex
    temp_root = darwin_temp() / ("os1-tmp-boundary-" + run_id)
    temp_root.mkdir(mode=0o700)
    private_directory(temp_root)
    report = {"schema": 1, "kind": "ZERO_MODEL_NATIVE_SHARED_TEMP_REGRESSION", "status": "FAIL",
              "started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "native_before": before,
              "qualified_version": QUALIFIED_VERSION, "rows": [], "model_calls": 0, "turn_starts": 0,
              "thread_starts": 0, "global_config_writes": 0, "auth_or_account_requests": 0,
              "limits": ["command/exec is not an LLM tool-call test or quality/max-reasoning proof",
                         "network.enabled=false is ACK-checked; no network attempt is made",
                         "native provider/auth/logging maintenance is outside model-tool scope"],
              "official_sources": ["https://learn.chatgpt.com/docs/app-server", "https://learn.chatgpt.com/docs/permissions"]}
    try:
        for fixed in (False, True):
            for mode in ("write", "read"):
                row = probe(args.native_executable, output, temp_root, run_id, mode, fixed)
                report["rows"].append(row)
                require(row["status"].startswith("PASS_"), "probe_failed_no_alternate_execution")
        report["native_after"] = qualified_tuple(args.native_executable, args.expected_launcher_sha, args.expected_backend_sha)
        require(before == report["native_after"], "native_identity_changed")
        require(all(x["lifecycle"]["terminal"] for x in report["rows"]), "process_not_terminal")
        report["status"] = "PASS_LEGACY_ESCAPE_REPRODUCED_FIXED_READ_AND_WRITE_DENY"
    except Exception as e:
        report["failure"] = str(e) if isinstance(e, Rejected) else type(e).__name__
    finally:
        try:
            temp_root.rmdir()
            report["private_scratch_cleanup"] = "removed_empty_owned_root"
        except OSError:
            report["private_scratch_cleanup"] = "HELD_NONEMPTY_OR_CHANGED"
            report["status"] = "FAIL_CLEANUP_HELD"
        report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        data = json.dumps(report, sort_keys=True, indent=2).encode() + b"\n"
        fd = os.open(output / "RESULT.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    print(json.dumps({"receipt": str(output / "RESULT.json"), "sha256": digest(data), "status": report["status"]}))
    return 0 if report["status"].startswith("PASS_") else 1


class OfflineTests(unittest.TestCase):
    def test_rpc_allowlist(self):
        for m in METHODS:
            self.assertEqual(request(m, 1, {})["method"], m)
        for m in ("turn/start", "thread/start", "process/spawn", "thread/shellCommand", "account/read", "account/login/start"):
            with self.assertRaises(Rejected):
                request(m, 1, {})

    def test_profiles_and_results(self):
        for mode in ("read", "write"):
            for fixed in (False, True):
                fs = profile_filesystem(Path("/owned/workspace"), Path("/owned/scratch"), mode, fixed)
                self.assertEqual(fs.get(":slash_tmp"), "deny" if fixed else None)
                self.assertEqual(fs["/owned/workspace"], mode)
                config = {"default_permissions": "test", "permissions": {"test": {"filesystem": fs, "network": {"enabled": False}}}}
                self.assertEqual(validate_profile(config, "test", fs)["filesystem"], fs)
                self.assertEqual(decode_command({"exitCode": 0, "stdout": json.dumps(expected_result(mode, fixed))}), expected_result(mode, fixed))

    def test_reject_malformed_or_empty_results(self):
        for result in ({}, {"exitCode": 0, "stdout": ""}, {"exitCode": 1, "stdout": "{}"},
                       {"exitCode": 0, "stdout": "{}"}, {"exitCode": 0, "stdout": "not JSON"}):
            with self.assertRaises(Rejected):
                decode_command(result)

    def test_profile_mismatch(self):
        fs = profile_filesystem(Path("/owned/workspace"), Path("/owned/scratch"), "read", True)
        for delta in ({"network": {"enabled": True}}, {"extends": "broad"},
                      {"filesystem": dict(fs, **{":slash_tmp": "write"})}):
            row = {"filesystem": fs, "network": {"enabled": False}, **delta}
            with self.assertRaises(Rejected):
                validate_profile({"default_permissions": "test", "permissions": {"test": row}}, "test", fs)

    def test_cleanup_exact_and_no_unknown_deletion(self):
        with tempfile.TemporaryDirectory(prefix="os1-tmp-boundary-offline-") as d:
            p = Path(d) / "owned"
            self.assertEqual(cleanup_exact_file(p, b"known"), "absent")
            p.write_bytes(b"unknown"); p.chmod(0o600)
            with self.assertRaises(Rejected):
                cleanup_exact_file(p, b"known")
            self.assertEqual(p.read_bytes(), b"unknown")
            p.write_bytes(b"known")
            self.assertEqual(cleanup_exact_file(p, b"known"), "removed_exact_owned_canary")
            self.assertFalse(p.exists())

    def test_new_private_output_and_no_reuse(self):
        with tempfile.TemporaryDirectory(prefix="os1-tmp-boundary-offline-") as d:
            root = Path(d).resolve(); root.chmod(0o700)
            p = new_output(str(root / "fresh")); self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700)
            with self.assertRaises(Rejected):
                new_output(str(p))

    def test_unknown_tuple_rejected_before_file_access(self):
        with self.assertRaises(Rejected):
            qualified_tuple("/no/such/bin/codex", "0" * 64, BACKEND_SHA)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute-zero-turn", action="store_true", help="explicitly authorize four zero-model sandbox probes")
    mode.add_argument("--self-test", action="store_true", help="offline pure/owned-file fixtures; no native process")
    parser.add_argument("--native-executable")
    parser.add_argument("--expected-launcher-sha")
    parser.add_argument("--expected-backend-sha")
    parser.add_argument("--output", help="new absolute directory beneath an existing canonical owned 0700 parent")
    args = parser.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OfflineTests)).wasSuccessful() else 1
    if not args.execute_zero_turn:
        parser.print_help()
        return 0
    if not all((args.native_executable, args.expected_launcher_sha, args.expected_backend_sha, args.output)):
        parser.error("execution requires native executable, both expected hashes and new private output")
    try:
        return execute(args)
    except (Rejected, OSError, ValueError) as e:
        print("zero-turn canary rejected: " + (str(e) if isinstance(e, Rejected) else type(e).__name__), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
