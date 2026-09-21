#!/usr/bin/env python3
"""Real socket/framing tests, without provider calls or a second thread writer."""
import json, socket, struct, subprocess, tempfile, threading
from pathlib import Path
root = Path(__file__).resolve().parents[1]
# Both initial and steering inputs must use Desktop's optimistic-input shape.
main = (root/'Sources/OS1/main.swift').read_text()
transport = (root/'Sources/OS1/CodexDesktopTransport.swift').read_text()
assert 'CodexDesktopTransport.textInput(prompt)' in main
assert 'CodexDesktopTransport.textInput(correction.text)' in main
assert 'CodexDesktopTransport.ensureRunning(threadID: threadID)' in main
assert 'CodexDesktopTransport.open(threadID: threadID)' not in main
assert 'static func ensureRunning(threadID: String)' in transport
assert 'process.arguments = ["-g", "-b", "com.openai.codex"]' in transport
assert 'codex://threads/' not in transport
with tempfile.TemporaryDirectory(prefix='os1-ipc-') as temp:
    temp = Path(temp)
    (temp/'main.swift').write_text('''import Foundation
 do {
 let input = CodexDesktopTransport.textInput("fixture 한글")
 precondition(input["text"] as? String == "fixture 한글")
 precondition((input["text_elements"] as? [[String: Any]])?.count == 0)
 let ipc = try CodexDesktopTransport(socketPath: CommandLine.arguments[1])
 let value = try ipc.request("fixture", version: 1, params: [:], timeout: 0.15)
 print(value["ok"] as? Bool == true ? "PASS" : "INVALID")
 } catch { print("REJECTED") }
''')
    subprocess.run(['swiftc',str(root/'Sources/OS1/CodexDesktopTransport.swift'),str(temp/'main.swift'),'-o',str(temp/'test')],check=True)
    def exact(c,n):
        b=b''
        while len(b)<n:
            d=c.recv(n-len(b))
            if not d: raise EOFError()
            b+=d
        return b
    def read(c): return json.loads(exact(c,struct.unpack('<I',exact(c,4))[0]))
    def send(c,x):
        b=json.dumps(x).encode(); frame=struct.pack('<I',len(b))+b
        for i in range(0,len(frame),3): c.sendall(frame[i:i+3])
    def run(case):
        path=str(temp/(case+'.sock')); srv=socket.socket(socket.AF_UNIX);srv.bind(path);srv.listen()
        errors=[]
        def server():
            try:
                with srv.accept()[0] as c:
                    r=read(c); assert r['method']=='initialize'
                    send(c,dict(type='response',requestId=r['requestId'],result=dict(clientId='test')))
                    r=read(c);assert r['method']=='fixture' and r['sourceClientId']=='test'
                    if case=='disconnect': return
                    if case=='oversized': c.sendall(struct.pack('<I',40*1024*1024));return
                    if case=='timeout':
                        import time;time.sleep(1.3);return
                    if case=='error': send(c,dict(type='response',requestId=r['requestId'],error='owner unavailable'));return
                    send(c,dict(type='client-discovery-request',requestId='discovery'))
                    assert read(c)['canHandle'] is False
                    send(c,dict(type='response',requestId='unrelated',result=dict(ok=False)))
                    send(c,dict(type='response',requestId=r['requestId'],result=dict(ok=True)))
            except BaseException as e: errors.append(repr(e))
        t=threading.Thread(target=server);t.start()
        result=subprocess.run([str(temp/'test'),path],capture_output=True,text=True,timeout=5)
        t.join(3);srv.close()
        assert not errors,(case,errors)
        assert result.stdout.strip()==('PASS' if case=='success' else 'REJECTED'),(case,result.stdout)
    for case in ['success','disconnect','oversized','error','timeout']: run(case)
print('PASS: 5 Desktop transport cases (fragmentation, discovery, correlation, disconnect, size, error, deadline)')
