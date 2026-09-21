#!/usr/bin/env python3
"""Post-dispatch recovery uses exact owner message identity; zero provider calls."""
import json,socket,struct,subprocess,tempfile,threading
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='os1-ack-') as d:
 d=Path(d)
 (d/'main.swift').write_text('''import Foundation
 do {
 let ipc = try CodexDesktopTransport(socketPath: CommandLine.arguments[1])
 try ipc.discover(threadID: "thread")
 print(try ipc.startTurn(threadID: "thread", request: [:], context: [:], deadline: Date().addingTimeInterval(0.5)))
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
 for case in ['ack','post-start-error','missing-ack','wrong-message','ambiguous','wrong-owner']:
  path=str(d/(case+'.sock'));srv=socket.socket(socket.AF_UNIX);srv.bind(path);srv.listen();errors=[];starts=[]
  def server():
   try:
    with srv.accept()[0] as c:
     c.settimeout(3)
     r=read(c);send(c,dict(type='response',requestId=r['requestId'],result=dict(clientId='test')))
     r=read(c);send(c,dict(type='response',requestId=r['requestId'],handledByClientId='owner',result={}))
     r=read(c);assert r['method']=='thread-follower-start-turn';starts.append(r)
     mid=r['params']['turnStart']['request']['clientUserMessageId'];assert mid
     answer=dict(type='response',requestId=r['requestId'],handledByClientId='owner')
     if case=='ack':answer['result']={'result':{'turn':{'id':'wanted'}}}
     elif case=='missing-ack':answer['result']={}
     else:answer['error']="Cannot read properties of undefined (reading 'cwd')"
     send(c,answer)
     if case=='ack':return
     while True:
      r=read(c);assert r['type']=='broadcast' and r['method']=='thread-stream-following-changed'
      turn=dict(turnId='wanted',status='inProgress',params=dict(clientUserMessageId=mid if case!='wrong-message' else 'other'))
      entities={'first':turn,'unrelated':dict(turnId='tail',status='inProgress',params=dict(clientUserMessageId='other'))}
      if case=='ambiguous':entities['duplicate']=dict(turn,turnId='second')
      send(c,dict(type='broadcast',method='thread-stream-state-changed',version=11,sourceClientId='impostor' if case=='wrong-owner' else 'owner',targetClientIds=['test'],params=dict(hostId='local',conversationId='thread',change=dict(type='snapshot',revision=1,conversationState=dict(id='thread',hostId='local',turnHistory=dict(kind='canonical',history=dict(entitiesByKey=entities)))))))
   except (EOFError,BrokenPipeError,ConnectionResetError):pass
   except BaseException as e:errors.append(repr(e))
  t=threading.Thread(target=server);t.start();r=subprocess.run([str(d/'test'),path],text=True,capture_output=True,timeout=5);t.join();srv.close()
  assert not errors,(case,errors)
  assert len(starts)==1,(case,'duplicate dispatch')
  assert r.stdout.strip()==('wanted' if case in ('ack','post-start-error','missing-ack') else 'REJECTED'),(case,r.stdout,r.stderr)
 print('PASS: 6 start acknowledgement cases; exact owner/message/turn; one start only')
