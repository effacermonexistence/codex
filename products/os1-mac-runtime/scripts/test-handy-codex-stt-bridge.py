#!/usr/bin/env python3
"""Handy -> os1 Codex dictation bridge: HTTP contract, token, recording rules,
language mapping, the transcript envelope and 503 fallbacks against a fake os1. No network beyond the
loopback test server, no Handy files, no credentials, no Codex/model call.
"""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import time
import unittest

BRIDGE = Path(__file__).resolve().parent / "handy-codex-stt-bridge.py"
TOKEN = "fixture-bridge-value-only"
TRANSCRIPT = "슈뢰딩거 방정식 설명해줘"


def envelope(text, **extra):
    return json.dumps(dict({"schema": "os1.dictation.transcript.v1", "text": text}, **extra), ensure_ascii=False) + "\n"
FAKE_OS1 = r'''#!/usr/bin/python3 -I
import json, os, sys, time
control = json.load(open(%(control)r))
with open(%(calls)r, "a") as log:
    log.write(json.dumps({"argv": sys.argv, "env": sorted(os.environ), "path": os.environ.get("PATH"),
                          "cwd": os.getcwd()}) + "\n")
if control.get("sleep"):
    time.sleep(control["sleep"])
sys.stdout.write(control.get("stdout", ""))
sys.stderr.write(control.get("stderr", ""))
sys.exit(control.get("exit", 0))
'''


def load_bridge():
    spec = importlib.util.spec_from_file_location("handy_codex_stt_bridge_fixture", BRIDGE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.directory = tempfile.TemporaryDirectory(prefix="handy-codex-bridge-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.recordings = self.root / "recordings"
        self.recordings.mkdir()
        self.settings_path = self.root / "settings_store.json"
        self.control = self.root / "control.json"
        self.calls = self.root / "calls.jsonl"
        self.os1 = self.root / "bin" / "os1"
        self.os1.parent.mkdir()
        self.os1.write_text(FAKE_OS1 % {"control": str(self.control), "calls": str(self.calls)})
        self.os1.chmod(0o700)
        self.write_settings()
        self.set_fake(stdout=envelope(TRANSCRIPT))
        self.bridge.SETTINGS_PATH = self.settings_path
        self.bridge.RECORDINGS_DIR = self.recordings
        self.bridge.OS1_BIN = self.os1
        self.wav = self.record("handy-1.wav")
        self.server = self.bridge.BridgeServer(("127.0.0.1", 0), self.bridge.Handler)
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        # A credential-like parent variable must never reach the os1 child.
        os.environ["OPENAI_API_KEY"] = "fixture-parent-environment-value"
        self.addCleanup(os.environ.pop, "OPENAI_API_KEY", None)

    def write_settings(self, selected="auto", app="ko", token=TOKEN):
        self.settings_path.write_text(json.dumps({"settings": {
            "selected_language": selected, "app_language": app,
            "post_process_api_keys": {"custom": token, "openai": "fixture-unused-provider-value"}}}))

    def set_fake(self, **control):
        self.control.write_text(json.dumps(control))

    def record(self, name, size=32044, age=0):
        path = self.recordings / name
        with path.open("wb") as handle:
            handle.write(b"RIFF" + (size - 8).to_bytes(4, "little") + b"WAVEfmt ")
            handle.truncate(size)
        moment = time.time() - age
        os.utime(path, (moment, moment))
        return path

    def calls_made(self):
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def request(self, method="POST", path="/v1/chat/completions", token=TOKEN, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        payload = body if body is not None else json.dumps({"model": "gpt-4o-transcribe", "messages": [
            {"role": "user", "content": "local transcript"}]}).encode()
        sent = {"Content-Type": "application/json"}
        if token is not None:
            sent["Authorization"] = "Bearer " + token
        sent.update(headers or {})
        connection.request(method, path, body=payload if method == "POST" else None, headers=sent)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, json.loads(data.decode("utf-8"))

    # HTTP contract (unchanged from the OpenAI bridge)
    def test_health_and_unknown_paths(self):
        self.assertEqual(self.request("GET", "/health"), (200, {"status": "ok"}))
        self.assertEqual(self.request("GET", "/v1/models")[0], 404)
        self.assertEqual(self.request("POST", "/v1/completions"), (404, {"error": "not_found"}))
        self.assertEqual(self.calls_made(), [])

    def test_token_is_required(self):
        self.assertEqual(self.request(token=None), (401, {"error": "unauthorized"}))
        self.assertEqual(self.request(token="wrong"), (401, {"error": "unauthorized"}))
        self.write_settings(token="")
        self.assertEqual(self.request(token=""), (401, {"error": "unauthorized"}))
        self.settings_path.write_text("not json")
        self.assertEqual(self.request(), (401, {"error": "unauthorized"}))
        self.assertEqual(self.calls_made(), [])

    def test_request_size_bounds(self):
        self.assertEqual(self.request(body=b""), (413, {"error": "invalid_request_size"}))
        # Rejected from the header alone, before any body is read (as before).
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        connection.putrequest("POST", "/v1/chat/completions")
        connection.putheader("Authorization", "Bearer " + TOKEN)
        connection.putheader("Content-Length", str(1024 * 1024 + 1))
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual((response.status, json.loads(response.read())), (413, {"error": "invalid_request_size"}))
        connection.close()
        self.assertEqual(self.request(headers={"Content-Length": "abc"}, body=b"{}")[0], 413)
        self.assertEqual(self.calls_made(), [])

    def test_success_is_the_os1_transcript(self):
        newer = self.record("handy-2.wav", size=96044)
        os.utime(self.wav, (time.time() - 5, time.time() - 5))
        status, payload = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(payload["object"], "chat.completion")
        self.assertEqual(payload["choices"][0]["message"], {"role": "assistant", "content": TRANSCRIPT})
        self.assertEqual(payload["choices"][0]["finish_reason"], "stop")
        self.assertEqual(payload["model"], "gpt-4o-transcribe")
        self.assertEqual(payload["usage"], {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
        [call] = self.calls_made()
        # Handy "auto" (the owner's setting) sends no language: Codex's own request.
        self.assertEqual(call["argv"][1:], ["dictation", "transcribe", "--wav", str(newer),
                                            "--timeout-seconds", "30", "--output", "json"])
        self.assertNotIn("OPENAI_API_KEY", call["env"])
        self.assertFalse([key for key in call["env"] if "KEY" in key or "TOKEN" in key or "OPENAI" in key], call["env"])
        given = self.bridge.child_environment()
        self.assertTrue(set(given) <= {"HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "PATH"}, given)
        self.assertEqual(given["HOME"], str(Path.home()))
        self.assertEqual(call["path"], "/usr/bin:/bin:/usr/sbin:/sbin")
        self.assertEqual(call["cwd"], "/")

    def test_timeout_follows_audio_length(self):
        os.utime(self.wav, (time.time() - 5, time.time() - 5))
        long = self.record("handy-long.wav", size=44 + 32000 * 40)
        self.assertEqual(self.request()[0], 200)
        [call] = self.calls_made()
        self.assertEqual(call["argv"][4], str(long))
        self.assertEqual(call["argv"][-4:], ["--timeout-seconds", "95", "--output", "json"])

    def test_language_mapping(self):
        # Auto never becomes a forced language (Codex's dictation sends none);
        # only an explicit Handy choice is forwarded.
        cases = [("auto", "ko", []), ("", "ko-KR", []), ("auto", "en", []), (None, "ko", []),
                 ("en", "ko", ["--language", "en"]), ("ko", "en", ["--language", "ko"]),
                 ("ko\r\nInjected", "ko", [])]
        for selected, app, expected in cases:
            self.write_settings(selected=selected, app=app)
            self.assertEqual(self.request()[0], 200, (selected, app))
            argv = self.calls_made()[-1]["argv"]
            middle = argv[5:-4]
            self.assertEqual(middle, expected, (selected, app))

    def test_latest_recording_rules(self):
        link = self.recordings / "handy-9.wav"
        link.symlink_to(self.wav)
        os.utime(link, (time.time() + 60, time.time() + 60), follow_symlinks=False)
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.calls_made()[-1]["argv"][4], str(self.wav), "a link never becomes the newest recording")
        link.unlink()
        os.utime(self.wav, (time.time() - 601, time.time() - 601))
        self.assertEqual(self.request(), (503, {"error": "remote_transcription_unavailable"}))
        self.record("handy-big.wav", size=25 * 1024 * 1024 + 1)
        self.assertEqual(self.request(), (503, {"error": "remote_transcription_unavailable"}))
        for path in self.recordings.iterdir():
            path.unlink()
        self.assertEqual(self.request(), (503, {"error": "remote_transcription_unavailable"}))
        self.assertEqual(len(self.calls_made()), 1, "rejected recordings never start os1")

    def test_every_os1_failure_is_503(self):
        for exit_code, reason in [(2, ""), (3, " [symbolic_link]"), (4, ""), (5, ""), (6, ""), (7, ""), (8, ""), (9, "")]:
            self.set_fake(stdout="must not be used\n", exit=exit_code,
                          stderr="OS-1 dictation: fixed status%s (exit %d)\n" % (reason, exit_code))
            with self.assertLogs("handy-codex-stt", level="WARNING") as logs:
                self.assertEqual(self.request(), (503, {"error": "remote_transcription_unavailable"}))
            self.assertIn("exit=%d" % exit_code, logs.output[-1])
            if reason:
                self.assertIn("reason=symbolic_link", logs.output[-1])
        for stdout in ["", "  \n  ", envelope(""), envelope(" \n "), TRANSCRIPT + "\n",
                       json.dumps({"text": TRANSCRIPT}), envelope(TRANSCRIPT, extra="x"),
                       json.dumps({"schema": "other", "text": TRANSCRIPT}), envelope(TRANSCRIPT).replace('"text"', '"Text"'),
                       json.dumps({"schema": "os1.dictation.transcript.v1", "text": 7}), json.dumps([TRANSCRIPT]),
                       "\xff\xfe"]:
            self.set_fake(stdout=stdout, exit=0)
            self.assertEqual(self.request()[0], 503, stdout)
        self.set_fake(stdout=envelope("x" * (1024 * 1024 + 1)), exit=0)
        self.assertEqual(self.request()[0], 503)

    def test_os1_without_the_dictation_command_is_503(self):
        # OS-1 <= build 444 (or any build lacking `dictation`) prints its usage
        # text on stdout and exits 0 for an unknown command; never paste it.
        usage = "OS-1 local runtime\n\n  os1 doctor\n  os1 version\n  os1 rcc-warmup\n"
        self.set_fake(stdout=usage, exit=0)
        with self.assertLogs("handy-codex-stt", level="WARNING") as logs:
            self.assertEqual(self.request(), (503, {"error": "remote_transcription_unavailable"}))
        self.assertNotIn("os1 doctor", "\n".join(logs.output))
        self.assertEqual(len(self.calls_made()), 1)

    def test_process_deadline_is_503(self):
        self.bridge.PROCESS_GRACE_SECONDS = -29.5  # 30 s CLI deadline -> 0.5 s process limit
        self.set_fake(stdout="late\n", sleep=5)
        started = time.monotonic()
        self.assertEqual(self.request()[0], 503)
        self.assertLess(time.monotonic() - started, 4)

    def test_missing_os1_is_503(self):
        self.bridge.OS1_BIN = self.root / "bin" / "absent-os1"
        self.assertEqual(self.request()[0], 503)
        self.os1.chmod(0o600)
        self.bridge.OS1_BIN = self.os1
        self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.calls_made(), [])

    def test_logs_never_contain_the_bridge_value_or_transcript(self):
        with self.assertLogs("handy-codex-stt", level="INFO") as logs:
            self.assertEqual(self.request()[0], 200)
            self.set_fake(exit=4, stderr="OS-1 dictation: fixed (exit 4) " + TOKEN + "\n")
            self.assertEqual(self.request()[0], 503)
        joined = "\n".join(logs.output)
        self.assertNotIn(TOKEN, joined)
        self.assertNotIn("슈뢰딩거", joined)
        self.assertIn("text_chars=", joined)


class SourceTests(unittest.TestCase):
    def test_no_api_key_or_openai_endpoint(self):
        source = BRIDGE.read_text()
        for forbidden in ["handy-openai-key", "api.openai.com", "KEY_HELPER", "read_openai_key", "urllib.request"]:
            self.assertNotIn(forbidden, source)
        self.assertIn('OS1_BIN = Path.home() / ".local/bin/os1"', source)
        self.assertIn('HOST = "127.0.0.1"', source)
        self.assertIn("PORT = 57321", source)
        mode = BRIDGE.stat().st_mode
        self.assertFalse(mode & stat.S_IWOTH)


if __name__ == "__main__":
    unittest.main(verbosity=1)
