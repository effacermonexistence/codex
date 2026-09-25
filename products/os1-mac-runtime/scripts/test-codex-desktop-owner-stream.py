#!/usr/bin/env python3
"""Exercise the native owner's real framed IPC stream; no model calls."""
import copy,json,socket,struct,subprocess,tempfile,threading
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='os1-owner-') as d:
 d=Path(d)
 (d/'main.swift').write_text('''import Foundation
 do {
 let ipc = try CodexDesktopTransport(socketPath: CommandLine.arguments[1])
 try ipc.discover(threadID: "thread")
 let first = try ipc.observeTurn(threadID: "thread", turnID: "wanted", deadline: Date().addingTimeInterval(1))
 print(first?["status"] ?? "missing")
 let second = try ipc.observeTurn(threadID: "thread", turnID: "wanted", deadline: Date().addingTimeInterval(1))
 print(second?["status"] ?? "missing")
 try ipc.follow(threadID: "thread", following: false)
 } catch { print("REJECTED") }
''')
 subprocess.run(['swiftc',str(root/'Sources/OS1/CodexDesktopTransport.swift'),str(d/'main.swift'),'-o',str(d/'test')],check=True)
 def exact(c,n):
  b=b''
  while len(b)<n:
   v=c.recv(n-len(b))
   if not v:raise EOFError()
   b+=v
  return b
 def read(c):return json.loads(exact(c,struct.unpack('<I',exact(c,4))[0]))
 def send(c,x):
  b=json.dumps(x).encode();c.sendall(struct.pack('<I',len(b))+b)
 def snapshot(status='inProgress',revision=2):
  return dict(type='broadcast',method='thread-stream-state-changed',version=11,sourceClientId='owner',targetClientIds=['test'],params=dict(hostId='local',conversationId='thread',change=dict(type='snapshot',revision=revision,conversationState=dict(id='thread',hostId='local',turnHistory=dict(kind='canonical',history=dict(entitiesByKey={'tail':dict(turnId='wanted',status=status,items=[])}))))))
 cases=['normal','wrong-owner','wrong-target','wrong-thread','wrong-version','wrong-state-id','missing-turn','stale','unsupported','disconnect']
 for case in cases:
  path=str(d/(case+'.sock'));srv=socket.socket(socket.AF_UNIX);srv.bind(path);srv.listen();errors=[]
  def server():
   try:
    with srv.accept()[0] as c:
     c.settimeout(3)
     r=read(c);send(c,dict(type='response',requestId=r['requestId'],result=dict(clientId='test')))
     r=read(c);assert r['method']=='thread-owner-discovery'
     send(c,dict(type='client-discovery-request',requestId='probe',method='thread-owner-discovery',version=1,params=dict(conversationId='other',hostId='local')))
     reply=read(c)
     assert reply['type']=='client-discovery-response' and reply['requestId']=='probe'
     assert reply.get('response')=={'canHandle':False} and 'canHandle' not in reply
     send(c,dict(type='response',requestId=r['requestId'],handledByClientId='owner',result=dict(supportsUntrustedAppInput=True)))
     assert read(c)['params']['following']
     if case=='disconnect':return
     x=snapshot()
     if case.startswith('wrong-'):
      if case=='wrong-owner':x['sourceClientId']='impostor'
      if case=='wrong-target':x['targetClientIds']=['another-client']
      if case=='wrong-thread':x['params']['conversationId']='another-thread'
      if case=='wrong-version':x['version']=10
      if case=='wrong-state-id':x['params']['change']['conversationState']['id']='another-thread'
      x['params']['change']['conversationState']['turnHistory']['history']['entitiesByKey']['tail']['status']='failed'
      send(c,x);x=snapshot()
     if case=='missing-turn':x['params']['change']['conversationState']['turnHistory']['history']['entitiesByKey']['tail']['turnId']='previous-turn'
     if case=='unsupported':x['params']['change']['conversationState']['turnHistory']['kind']='unknown'
     send(c,x)
     if case=='unsupported':return
     assert read(c)['params']['following']
     if case=='stale':send(c,snapshot('interrupted',1))
     send(c,snapshot('completed',3))
     assert read(c)['params']['following'] is False
   except BaseException as e:errors.append(repr(e))
  t=threading.Thread(target=server);t.start();r=subprocess.run([str(d/'test'),path],text=True,capture_output=True,timeout=5);t.join();srv.close()
  expected='REJECTED' if case in ('unsupported','disconnect') else ('missing' if case=='missing-turn' else 'inProgress')+'\ncompleted'
  assert not errors,(case,errors)
  assert r.stdout.strip()==expected,(case,r.stdout,r.stderr)
 print('PASS:',len(cases),'owner-stream cases; owner/target/thread/version/state identity, stale snapshots, exact turn, failure boundaries')
