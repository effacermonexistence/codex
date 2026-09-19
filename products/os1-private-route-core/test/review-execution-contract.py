#!/usr/bin/env python3
"""No model calls: review delivery validity must not depend on prose length."""
import importlib.util
import os
from pathlib import Path
import unittest
root = Path(os.environ['OS1_PRIVATE_CORE_DIR'])
def load(name):
    spec = importlib.util.spec_from_file_location(name, root / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._private_log = lambda *args: None
    return module
core = load('os1_local_core')
class ReviewContract(unittest.TestCase):
    def verify(self, **changes):
        request = dict(prompt='Confirm this request was received.', output='Received.',
            stderr='', verification_profile='executed_review', native_persistence='verified',
            exit_code=0, attempt=1, provider='codex', provider_pinned=True)
        request.update(changes)
        return core.verify(request)
    def test_length_is_not_quality(self):
        for profile in ('executed_review', 'source_review'):
            for text in ('OK', '확인했습니다.', 'This verification request reached the backend.', 'a'*79, 'a'*80, 'a'*1000):
                with self.subTest(profile=profile, length=len(text)):
                    result=self.verify(output=text, verification_profile=profile)
                    self.assertEqual(result['outcome'], 'pass')
                    self.assertEqual(result['reason_code'], 'RECEIPT_EXECUTION_RECORDED')
    def test_unknown_or_source_requirements_not_erased(self):
        for suffix in (' Then inspect source files', ' Explain the current release', ' Then deploy', ' and modify code'):
            self.assertNotEqual(self.verify(prompt='Confirm this request was received.'+suffix)['outcome'],'pass')
    def test_incident_and_compositional_variants(self):
        for prompt in ('Read-only runtime verification. Do not edit files, send messages, deploy, or invoke tools. In one short sentence, acknowledge that this verification request reached the backend. The standard persona greeting is allowed. No exact output matching is requested.', 'Acknowledge my message has been received.', 'Read-only. Confirm the task reached the executor. Do not run commands.'):
            self.assertEqual(self.verify(prompt=prompt)['outcome'],'pass')
    def test_failed_execution_still_rejected(self):
        for changes in ({'output':''}, {'output':'   '}, {'exit_code':1}, {'native_persistence':'unverified'}):
            with self.subTest(changes=changes):
                self.assertNotEqual(self.verify(**changes)['outcome'],'pass')
    def test_change_requires_change(self):
        self.assertNotEqual(self.verify(verification_profile='executed_change', prompt='Modify the source file.')['outcome'],'pass')
    def test_exact_contract_still_enforced(self):
        self.assertNotEqual(self.verify(verification_profile='native_record', prompt='Reply with exactly EXPECTED', output='WRONG')['outcome'],'pass')
    def test_old_policy_retains_issued_contract(self):
        old=load('os1_legacy_20260908_29')
        self.assertNotEqual(old.POLICY_SHA256,core.POLICY_SHA256)
        self.assertEqual(old.verify(dict(prompt='Acknowledge briefly.',output='Received.',verification_profile='executed_review',native_persistence='verified',exit_code=0,attempt=1))['reason_code'],'REVIEW_EVIDENCE_TOO_THIN')
if __name__=='__main__': unittest.main()
