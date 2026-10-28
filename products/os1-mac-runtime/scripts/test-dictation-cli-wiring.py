#!/usr/bin/env python3
"""`os1 dictation transcribe` uses the App's own Codex dictation lane.

Source-only gate (no build, App, microphone, credential, network or model):
the CLI's credential and transport are the exact expressions OS1App's voice
controller defaults to, its batch call is the same library function the App's
WAV fallback calls, and the command adds no auth flow, key or token output.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "Sources/OS1/main.swift").read_text()
COMMAND = (ROOT / "Sources/OS1/DictationCommand.swift").read_text()
CORE = (ROOT / "Sources/OS1Context/CodexDictationFileTranscription.swift").read_text()
APP = (ROOT / "Sources/OS1App/OS1App.swift").read_text()
BRIDGE = (ROOT / "scripts/handy-codex-stt-bridge.py").read_text()
checks = 0


def check(condition, label):
    global checks
    if not condition:
        raise SystemExit("FAIL: " + label)
    checks += 1


def code(text):
    """Swift text without // comments, so prose cannot satisfy a code check."""
    return "\n".join(line.split("//", 1)[0] for line in text.splitlines())


controller = APP.split("private final class VoiceDictationController:", 1)[1].split(
    "// MARK: - Native dictation controller fixtures", 1)[0]
APP_CREDENTIAL = "CodexDictationAuthorization.credential()"
APP_TRANSPORT = "CodexDictationURLSessionTransport()"
check(f"credential: @escaping CodexNativeDictation.Credential = {APP_CREDENTIAL}," in controller and
      f"transport: any CodexDictationTransport = {APP_TRANSPORT}," in controller,
      "the App's voice controller defaults are the reference credential and transport")
check("CodexNativeDictation.transcribe(wav: wav, credential: credential, transport: transport)" in controller,
      "the App's WAV fallback is the Codex-native batch call")

command = code(COMMAND)
check(command.count(f"credential: {APP_CREDENTIAL},") == 1 and command.count(f"transport: {APP_TRANSPORT},") == 1,
      "the CLI passes exactly the App's credential and transport")
check(command.count("await CodexDictationFileTranscription.run(arguments,") == 1, "one CLI entry into the shared core")
check(command.count("FileHandle.standardOutput.write(Data((text + \"\\n\").utf8))") == 1 and "print(" not in command,
      "stdout receives the transcript and nothing else")

main = code(MAIN)
check(main.count('case "dictation": exit(await DictationCommand.run(arguments))') == 1,
      "os1 dispatches `dictation` to the command and exits with its status")
check(MAIN.count("os1 dictation transcribe --wav /path/recording.wav [--language ko|auto] [--timeout-seconds 1...300] [--output text|json]") == 1,
      "usage names the command")

core = code(CORE)
check(core.count("try await CodexNativeDictation.transcribe(wav: wav, language: language,") == 1,
      "the core calls the App's batch function, with the owner language when given")
for forbidden in ["URLSession", "Process(", "Authorization", "Bearer", "UserDefaults", "Keychain", "SecItem",
                  "auth.json", "createFile", ".write(to:", "print(", "handy", "Handy", "api.openai.com", "OPENAI"]:
    check(forbidden not in core, "the core has no " + forbidden)
check("O_NOFOLLOW" in core and "lstat(" in core and "fstat(" in core and "st_uid == owner" in core,
      "the file read never follows a final link and requires the owner's regular file")
check(core.count("public static let maximumFileBytes = 25 * 1_024 * 1_024") == 1 and
      core.count("public static let maximumUploadBytes = 16 * 1_024 * 1_024") == 1,
      "25 MiB file bound and the App builder's 16 MiB upload limit")
statuses = dict(re.findall(r"case (\w+) = (\d+)\n", core.split("public enum ExitStatus", 1)[1].split("public var message", 1)[0]))
check(statuses == {"transcribed": "0", "usage": "2", "audioRejected": "3", "noCredential": "4", "transportFailed": "5",
                   "timedOut": "6", "serviceRejected": "7", "emptyTranscript": "8", "invalidResponse": "9"},
      "documented distinct exit statuses")
check(re.search(r"private (final )?(class|actor)", core) is None and re.search(r"private (final )?(class|actor)", command) is None,
      "no file-private class names in shipped code")

for forbidden in ["handy-openai-key", "api.openai.com", "read_openai_key", "urllib.request"]:
    check(forbidden not in BRIDGE, "the Handy bridge has no " + forbidden)
check('"dictation", "transcribe", "--wav"' in BRIDGE and 'OS1_BIN = Path.home() / ".local/bin/os1"' in BRIDGE,
      "the Handy bridge runs the installed os1 dictation command")
check('self.send_json(503, {"error": "remote_transcription_unavailable"})' in BRIDGE,
      "every bridge failure leaves Handy its local transcript")
check(core.count('public static let transcriptSchema = "os1.dictation.transcript.v1"') == 1 and
      'TRANSCRIPT_SCHEMA = "os1.dictation.transcript.v1"' in BRIDGE and '"--output", "json"' in BRIDGE and
      "text = transcript_from_envelope(result.stdout).strip()" in BRIDGE,
      "the bridge accepts only os1's transcript envelope, never an older os1's usage text")
check("app_language" not in BRIDGE, "Handy 'auto' is never forced to a language (Codex's request sends none)")

print(f"os1 dictation CLI wiring: {checks} source checks PASS (App credential/transport/batch call; no auth flow, key or token output)")
sys.exit(0)
