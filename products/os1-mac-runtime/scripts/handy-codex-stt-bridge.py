#!/usr/bin/python3
"""Local bridge that lets Handy use Codex's own dictation (OS-1 build 445+).

Drop-in replacement for handy_openai_stt_bridge.py with the same HTTP contract:
Handy calls it as an OpenAI-compatible chat-completion "post-process" provider
(127.0.0.1:57321, Bearer = Handy's own custom-provider value). The bridge
ignores the local transcript and re-transcribes the WAV Handy just saved, but
instead of the OpenAI API (an API key) it runs

    ~/.local/bin/os1 dictation transcribe --wav PATH [--language L] --timeout-seconds N --output json

which uses the exact Codex-native batch lane and ChatGPT/Codex sign-in that the
OS-1 app's voice button uses. Handy's "auto" language sends no language field,
exactly as Codex's own dictation; only an explicit Handy language is forwarded.
No API key, no payment, no stored credential: this file never reads a key,
token or credential file, and never logs one. Only os1's one-line
{"schema": "os1.dictation.transcript.v1", "text": ...} envelope counts as a
transcript, so an os1 without the command (build <= 444 prints its usage text
with exit 0) can never be pasted. Any failure returns 503 so Handy keeps
(pastes) its own local transcript.

Install (after OS-1 build 445+ is installed, i.e. `~/.local/bin/os1 version`
reports 0.9.379 or later): copy this file next to the old bridge in
~/Library/Application Support/com.pais.handy/, point the existing LaunchAgent
com.lua.handy.openai-stt-bridge's ProgramArguments at it, reload the agent,
then enable Handy's post-process with the existing "custom" provider
(base URL http://127.0.0.1:57321/v1). The old key helper stays unused.
"""

import json
import logging
import os
from pathlib import Path
import re
import stat
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 57321
APP_SUPPORT = Path.home() / "Library/Application Support/com.pais.handy"
SETTINGS_PATH = APP_SUPPORT / "settings_store.json"
RECORDINGS_DIR = APP_SUPPORT / "recordings"
OS1_BIN = Path.home() / ".local/bin/os1"
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_RECORDING_AGE_SECONDS = 600
MAX_CHAT_REQUEST_BYTES = 1024 * 1024
MAX_TRANSCRIPT_BYTES = 1024 * 1024
# The os1 CLI's own deadline covers credential + upload; the process limit adds
# room for process start and its bounded cancellation grace.
PROCESS_GRACE_SECONDS = 15
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MODEL_PATTERN = re.compile(r"^[\x21-\x7e]{1,128}$")
DEFAULT_MODEL = "codex-native-dictation"
TRANSCRIPT_SCHEMA = "os1.dictation.transcript.v1"
# Never forwarded: API keys or other credential-bearing environment values.
CHILD_ENVIRONMENT_KEYS = ("HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR")
CHILD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
LOG = logging.getLogger("handy-codex-stt")


class BridgeUnavailable(RuntimeError):
    """Fixed-vocabulary failure; Handy keeps its local transcript."""


def load_handy_settings():
    with SETTINGS_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)["settings"]


def expected_bridge_token():
    settings = load_handy_settings()
    return settings.get("post_process_api_keys", {}).get("custom", "")


def latest_recording():
    # Same rule as before (newest *.wav, at most 10 minutes old, 25 MiB),
    # considering regular files only so a link cannot become the newest entry.
    candidates = []
    for path in RECORDINGS_DIR.glob("*.wav"):
        try:
            info = path.lstat()
        except OSError:
            continue
        if stat.S_ISREG(info.st_mode):
            candidates.append((info.st_mtime, path, info))
    if not candidates:
        raise BridgeUnavailable("no recordings found")
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, path, info = candidates[0]
    if time.time() - info.st_mtime > MAX_RECORDING_AGE_SECONDS:
        raise BridgeUnavailable("latest recording is too old")
    if info.st_size > MAX_AUDIO_BYTES:
        raise BridgeUnavailable("latest recording is too large")
    return path, info.st_size


def dictation_language(settings):
    """Handy's explicit language choice. 'auto' (or none) sends no language
    field, byte-identical to Codex's own dictation request, which auto-detects."""
    language = settings.get("selected_language") or ""
    if not isinstance(language, str) or language in ("", "auto"):
        return None
    return language if LANGUAGE_PATTERN.match(language) else None


def child_environment():
    environment = {key: os.environ[key] for key in CHILD_ENVIRONMENT_KEYS if key in os.environ}
    environment["HOME"] = str(Path.home())
    environment["PATH"] = CHILD_PATH
    return environment


def os1_command(wav_path, language, timeout_seconds):
    command = [str(OS1_BIN), "dictation", "transcribe", "--wav", str(wav_path)]
    if language:
        command += ["--language", language]
    command += ["--timeout-seconds", str(int(timeout_seconds)), "--output", "json"]
    return command


def transcript_from_envelope(stdout_bytes):
    """The transcript inside os1's exact {schema, text} line; anything else
    (an older os1's usage text, plain text, other JSON) is not a transcript."""
    try:
        payload = json.loads(stdout_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise BridgeUnavailable("os1 did not return a dictation transcript (OS-1 build 445+ required)") from error
    if (not isinstance(payload, dict) or set(payload) != {"schema", "text"}
            or payload["schema"] != TRANSCRIPT_SCHEMA or not isinstance(payload["text"], str)):
        raise BridgeUnavailable("os1 did not return a dictation transcript (OS-1 build 445+ required)")
    return payload["text"]


def status_summary(returncode, stderr_bytes):
    # Only os1's fixed vocabulary is logged: exit status and a [reason] code.
    text = stderr_bytes.decode("utf-8", "replace")[-512:] if stderr_bytes else ""
    reason = re.findall(r"\[([a-z_]{1,40})\]", text)
    return "exit=%s%s" % (returncode, (" reason=" + reason[-1]) if reason else "")


def send_transcription_request():
    settings = load_handy_settings()
    wav_path, audio_bytes = latest_recording()
    if not (OS1_BIN.is_file() and os.access(OS1_BIN, os.X_OK)):
        raise BridgeUnavailable("os1 CLI is not installed")
    language = dictation_language(settings)
    audio_seconds = max(0.0, (audio_bytes - 44) / 32000.0)
    timeout = min(120.0, max(30.0, audio_seconds * 2.0 + 15.0))
    try:
        result = subprocess.run(
            os1_command(wav_path, language, timeout),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=child_environment(),
            cwd="/",
            timeout=timeout + PROCESS_GRACE_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise BridgeUnavailable("os1 dictation did not finish in time") from error
    except OSError as error:
        raise BridgeUnavailable("os1 dictation could not start") from error
    if result.returncode != 0:
        raise BridgeUnavailable("os1 dictation failed (%s)" % status_summary(result.returncode, result.stderr))
    if len(result.stdout) > MAX_TRANSCRIPT_BYTES:
        raise BridgeUnavailable("os1 dictation output is too large")
    text = transcript_from_envelope(result.stdout).strip()
    if not text:
        raise BridgeUnavailable("os1 dictation returned an empty transcription")
    LOG.info(
        "Codex dictation succeeded (audio_seconds=%.2f, language=%s, text_chars=%d)",
        audio_seconds,
        language or "auto",
        len(text),
    )
    return text


def requested_model(body):
    try:
        model = json.loads(body.decode("utf-8")).get("model")
    except (ValueError, AttributeError, UnicodeDecodeError):
        return DEFAULT_MODEL
    return model if isinstance(model, str) and MODEL_PATTERN.match(model) else DEFAULT_MODEL


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = "HandyCodexSttBridge/1.0"

    def log_message(self, _format, *_args):
        return

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_json(404, {"error": "not_found"})
            return

        try:
            expected = expected_bridge_token()
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            expected = ""
        supplied = self.headers.get("Authorization", "")
        if not isinstance(expected, str) or not expected or supplied != "Bearer " + expected:
            self.send_json(401, {"error": "unauthorized"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_CHAT_REQUEST_BYTES:
            self.send_json(413, {"error": "invalid_request_size"})
            return
        body = self.rfile.read(content_length)

        try:
            transcript = send_transcription_request()
        except Exception as error:  # every failure keeps Handy's local transcript
            reason = str(error) if isinstance(error, BridgeUnavailable) else type(error).__name__
            LOG.warning("Codex transcription unavailable: %s", reason)
            self.send_json(503, {"error": "remote_transcription_unavailable"})
            return
        self.send_json(
            200,
            {
                "id": "handy-codex-stt",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": requested_model(body),
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": transcript},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            },
        )


def main():
    os.umask(0o077)
    LOG.info("Handy Codex STT bridge listening on %s:%d (os1 %s)", HOST, PORT, OS1_BIN)
    BridgeServer((HOST, PORT), Handler).serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
