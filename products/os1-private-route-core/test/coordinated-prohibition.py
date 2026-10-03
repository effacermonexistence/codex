#!/usr/bin/env python3
"""Source-pinned parser/verifier regression. Zero provider calls. Not public uplift."""
import importlib.util, os, pathlib, tempfile, unittest
root=pathlib.Path(os.environ['OS1_PRIVATE_CORE_DIR']).resolve()
spec=importlib.util.spec_from_file_location('candidate',root/'os1_local_core.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core);core._private_log=lambda *args:None
class Lists(unittest.TestCase):
    def route(self,p):
        with tempfile.TemporaryDirectory() as d:return core.route(dict(prompt=p,provider_preference='codex',codex_capacity=30,claude_capacity=100,attempt=1,state_dir=d))
    def test_no_mutation_from_bounded_prohibited_list(self):
        for separator in ['·','ㆍ',',','/']:
            for end in ['금지','없이','하지 마','는 하지 마세요']:
                prompt='선택된 폴더의 result.txt를 읽고 그대로 답해. '+separator.join(['파일 변경','웹','브라우저','구매','외부 전송','서브에이전트'])+' '+end+'.'
                with self.subTest(separator=separator,end=end):
                    r=self.route(prompt);self.assertEqual(r['permission_profile'],'read_only');self.assertNotEqual(r['verification_profile'],'executed_change')
                    v=core.verify(dict(prompt=prompt,output='UNCHANGED_FILE_CONTENT',stderr='unrelated MCP diagnostic',verification_profile=r['verification_profile'],native_persistence='verified',exit_code=0,attempt=1,provider='codex',provider_pinned=True,before_workspace_hash='a'*64,after_workspace_hash='a'*64))
                    self.assertEqual(v['outcome'],'pass')
    def test_affirmative_edit_outside_list_still_needs_change(self):
        for prompt in ['app.py를 수정해. 웹·구매·외부 전송 금지.','app.py를 고쳐. 브라우저·결제·서브에이전트 금지.']:
            r=self.route(prompt);self.assertEqual(r['verification_profile'],'executed_change')
            v=core.verify(dict(prompt=prompt,output='OK',stderr='',verification_profile=r['verification_profile'],native_persistence='verified',exit_code=0,attempt=1,before_workspace_hash='a'*64,after_workspace_hash='a'*64));self.assertNotEqual(v['outcome'],'pass')
    def test_literal_contract_and_execution_gates_remain(self):
        p='Read-only. Reply exactly READ_ONLY_OK. Do not change files.';r=self.route(p)
        for output,persistence,code in [('WRONG','verified',0),('READ_ONLY_OK','missing',0),('READ_ONLY_OK','verified',1)]:
            self.assertNotEqual(core.verify(dict(prompt=p,output=output,stderr='',verification_profile=r['verification_profile'],native_persistence=persistence,exit_code=code,attempt=1))['outcome'],'pass')
if __name__=='__main__':unittest.main()
