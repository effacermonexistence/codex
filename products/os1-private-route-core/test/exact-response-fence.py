#!/usr/bin/env python3
"""Private-adapter contract regression; does not call models or expose policy.

Run with OS1_PRIVATE_CORE_DIR pointing to the verified private source package.
CI without that package should not pretend these private tests ran.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

root = Path(os.environ["OS1_PRIVATE_CORE_DIR"]).resolve()
spec = importlib.util.spec_from_file_location("private_adapter", root / "os1_local_core.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
core._private_log = lambda *args: None

INCIDENT = (
    "Read-only reconciliation of failed OS1 Fleet job 00000000-0000-4000-8000-000000000000. "
    "This is not permission to replay that job or perform any installation. "
    "Using only read tools, reply with exactly READ_ONLY_OK. "
    "Do not run commands, restart services, change files, read authentication caches "
    "or quote private log payloads."
)


class ResponseFence(unittest.TestCase):
    def route(self, prompt):
        with tempfile.TemporaryDirectory(prefix="os1-response-fence-") as tmp:
            return core.route(dict(prompt=prompt, provider_preference="codex",
                                   codex_capacity=30, claude_capacity=100,
                                   attempt=1, state_dir=tmp))

    def verify(self, prompt, output="READ_ONLY_OK", **overrides):
        request = dict(prompt=prompt, output=output, stderr="",
                       verification_profile=self.route(prompt)["verification_profile"],
                       native_persistence="verified", exit_code=0, attempt=1,
                       provider="codex", provider_pinned=True)
        request.update(overrides)
        return core.verify(request)

    def test_incident_is_exact_read_only_first_attempt(self):
        route = self.route(INCIDENT)
        self.assertEqual(route["permission_profile"], "read_only")
        self.assertEqual(route["verification_profile"], "native_record")
        self.assertEqual(self.verify(INCIDENT)["reason_code"], "EXACT_RESPONSE_VERIFIED")

    def test_sentence_punctuation_and_supported_prohibitions(self):
        for punctuation in ("", ".", "!"):
            for fence in ("", " Do not run commands.", " Never restart services.",
                          " Do not change files, services or settings.",
                          " Do not read authentication caches or quote private log payloads.",
                          "\nDo not deploy.\nNever publish."):
                prompt = "Read-only. Reply with exactly READ_ONLY_OK" + punctuation
                if fence and not punctuation:
                    prompt += "\n"
                prompt += fence
                with self.subTest(prompt=prompt):
                    self.assertEqual(self.verify(prompt)["outcome"], "pass")

    def test_literal_interior_periods_preserved(self):
        for suffix in ("", ".", ". Do not change files."):
            self.assertEqual(self.verify("Read-only. Return exactly VERSION_1.2" + suffix,
                                         output="VERSION_1.2")["outcome"], "pass")

    def test_client_normalized_fence_retains_response_contract(self):
        for suffix in ("read-only", "read-only.", "read only", "read-only\nread-only"):
            prompt = "Read-only check: reply with exactly READ_ONLY_OK. " + suffix
            with self.subTest(suffix=suffix):
                self.assertEqual(self.route(prompt)["permission_profile"], "read_only")
                self.assertEqual(self.verify(prompt)["reason_code"], "EXACT_RESPONSE_VERIFIED")
                self.assertEqual(self.verify(prompt, "WRONG")["reason_code"], "EXACT_RESPONSE_MISMATCH")
        for suffix in ("read-only review of result.txt", "read-only, then explain why", "read-only unless approved"):
            self.assertFalse(core._bounded_exact_response_task("Reply exactly READ_ONLY_OK. " + suffix))

    def test_wrong_or_extra_output_fails(self):
        for output in ("WRONG", "READ_ONLY_OK\nverified", "READ_ONLY_OK."):
            self.assertEqual(self.verify(INCIDENT, output)["reason_code"], "EXACT_RESPONSE_MISMATCH")

    def test_native_execution_gates_remain_hard(self):
        for fields, reason in ((dict(exit_code=1), "EXECUTOR_NONZERO"),
                               (dict(native_persistence="missing"), "NATIVE_RECORD_UNVERIFIED"),
                               (dict(output=""), "EMPTY_OUTPUT"),
                               (dict(output="I cannot execute this task."), "EXECUTOR_BLOCKED_OR_REFUSED")):
            self.assertEqual(self.verify(INCIDENT, **fields)["reason_code"], reason)

    def test_source_value_request_not_converted_to_literal(self):
        for prompt in ("Read-only. Return exactly the fields found in this file. Do not change files.",
                       "Read-only. Reply with exactly the current release version. Do not run commands."):
            self.assertEqual(self.route(prompt)["verification_profile"], "executed_review")
            self.assertNotEqual(self.verify(prompt, "READ_ONLY_OK")["outcome"], "pass")

    def test_additional_positive_or_mixed_requirements_not_erased(self):
        for suffix in ("Then create result.txt.", "Do not run commands, but create result.txt.",
                       "If approved, do not change files.", "Explain why.",
                       'The document says "Do not run commands."'):
            prompt = "Read-only. Reply with exactly READ_ONLY_OK. " + suffix
            self.assertFalse(core._bounded_exact_response_task(prompt))

    def test_mutation_then_marker_not_exact_gate(self):
        prompt = "Create result.txt and write checked content, then reply exactly DONE."
        route = self.route(prompt)
        self.assertEqual(route["permission_profile"], "workspace_write")
        self.assertEqual(route["verification_profile"], "executed_change")
        self.assertNotEqual(self.verify(prompt, "DONE")["outcome"], "pass")

    def test_previous_issuing_policy_preserved(self):
        previous = importlib.util.spec_from_file_location("previous_adapter", root / "os1_legacy_20260908_26.py")
        module = importlib.util.module_from_spec(previous)
        previous.loader.exec_module(module)
        self.assertEqual(module.POLICY_SHA256, "0f8a0b82fbbe469c42661f3fb689692adb80112764b91e3e12220553645c294d")
        self.assertNotEqual(module.POLICY_SHA256, core.POLICY_SHA256)
        self.assertFalse(module._bounded_exact_response_task(INCIDENT))


if __name__ == "__main__":
    unittest.main()
