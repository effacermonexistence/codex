#!/usr/bin/env python3
"""Actual source-extracted Swift exact tuple mapping, no native/provider launch."""
from pathlib import Path
import hashlib,json,subprocess,tempfile
R=Path(__file__).resolve().parents[1];profile=(R/'Sources/OS1/TaskQualityRuntime.swift').read_text();main=(R/'Sources/OS1/main.swift').read_text()
a=profile.index('    static let qualifiedNativeLauncherSHA256 =');b=profile.index('    func bindNative(executable:',a);fragment=profile[a:b]
bind=profile[b:profile.index('    func verifyRunningNative(',b)]
assert 'try bindFile(wrapper.path, expected: Self.qualifiedNativeLauncherSHA256)'in bind
assert 'try bindFile(binary.path)'in bind
assert bind.index('Self.qualifiedNativeVersion(')<bind.index('nativeExecutable = binary.path')
fn=main[main.index('private func rccLocalQualityAppServer('):main.index('\nfunc runCodexDesktopTurn(',main.index('private func rccLocalQualityAppServer('))]
assert fn.index('try localQualityProfile.bindNative(executable: codex)')<fn.index('let discovery = try CodexAppServerClient(')
program='import Foundation\nenum Profile {\n'+fragment+'}\n'+r'''
var checks=0
func check(_ value:Bool) { precondition(value,"native tuple qualification regression"); checks += 1 }
let old=Profile.qualifiedNativeBackendSHA256, current=Profile.qualifiedCurrentNativeBackendSHA256, launcher=Profile.qualifiedNativeLauncherSHA256
check(Profile.qualifiedNativeVersion(launcherSHA256:launcher,backendSHA256:old)=="codex-cli 0.163.0-alpha.10.2")
check(Profile.qualifiedNativeVersion(launcherSHA256:launcher,backendSHA256:current)=="codex-cli 0.163.0-alpha.11.1")
check(Profile.qualifiedNativeVersion(launcherSHA256:launcher,backendSHA256:current) != "codex-cli 0.163.0-alpha.10.2")
check(Profile.qualifiedNativeVersion(launcherSHA256:launcher,backendSHA256:old) != "codex-cli 0.163.0-alpha.11.1")
for pair in [(current,launcher),(old,launcher),(String(repeating:"0",count:64),current),(launcher,String(repeating:"0",count:64)),(launcher,"0d5ac7aae20c4eda6242428d5e218c55ba96d8763fda2a271088ff37104b9d28")] {
 check(Profile.qualifiedNativeVersion(launcherSHA256:pair.0,backendSHA256:pair.1)==nil)
}
print("ACTUAL_NATIVE_QUALIFICATION_MAPPING_PASS: \(checks) checks; no native/SDK/model process")
'''
with tempfile.TemporaryDirectory(prefix='os1-native-qualification-map-')as d:
 p=Path(d);(p/'main.swift').write_text(program);subprocess.run(['swiftc',str(p/'main.swift'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
print(json.dumps({'status':'PASS','profile_source_sha256':hashlib.sha256(profile.encode()).hexdigest(),'scope':'actual Swift exact tuple map plus prelaunch gate source wiring; no fullCLI/nativeprofile/model proof','model_calls':0}))
