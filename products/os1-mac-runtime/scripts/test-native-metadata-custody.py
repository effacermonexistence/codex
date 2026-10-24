#!/usr/bin/env python3
"""Compile exact reader/predicate functions; temporary custody fixtures only.
No native provider, model, GUI, RPC, account, answer or task store is accessed.
"""
import pathlib,tempfile,subprocess,sys,re
W=pathlib.Path(__file__).resolve().parents[1];source=W/'Sources/OS1Context/RCCNativeDisplayObservation.swift';s=source.read_text()
def fn(name):
 pattern=r'    (?:public |private )?static func '+re.escape(name)+r'\('
 m=re.search(pattern,s);assert m,name;start=m.start();opening=s.index('{',m.end());depth=1;i=opening+1
 while depth:
  if s[i]=='{':depth+=1
  elif s[i]=='}':depth-=1
  i+=1
 return s[start:i].replace('private static func','static func').replace('public static func','static func')
# Verify the generic private policy still requires owner-only both pre/post.
private=fn('read');assert private.count('0o077')==2 and '0o022'not in private
code='import Darwin\nimport Foundation\nstruct Sut {\n'+ '\n'.join(fn(n)for n in['nativeMetadataFileIsSafe','readOwnedNativeMetadata','readNativeMetadata'])+'\n}\n'
code+=r'''
var checks=0
func require(_ v:Bool,_ m:String) { if !v { fatalError(m) }; checks+=1 }
let root=URL(fileURLWithPath:CommandLine.arguments[1]).resolvingSymlinksInPath()
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
let file=root.appendingPathComponent("own.jsonl"),bytes=Data("{\"schema\":1}\n".utf8)
try bytes.write(to:file)
for mode in [0o600,0o644] { try FileManager.default.setAttributes([.posixPermissions:mode],ofItemAtPath:file.path)
 require(Sut.readNativeMetadata(file.path)==bytes,"valid owner native file rejected") }
for mode in [0o620,0o602,0o666,0o755,0o4600] { try FileManager.default.setAttributes([.posixPermissions:mode],ofItemAtPath:file.path)
 require(Sut.readNativeMetadata(file.path)==nil,"unsafe native permissions accepted") }
try FileManager.default.setAttributes([.posixPermissions:0o644],ofItemAtPath:file.path)
var st=stat(); require(lstat(file.path,&st)==0,"stat failed")
var foreign=st;foreign.st_uid=getuid()+1
require(!Sut.nativeMetadataFileIsSafe(foreign,maximum:16000000,expectedUID:getuid()),"foreign uid accepted")
var hard=st;hard.st_nlink=2
require(!Sut.nativeMetadataFileIsSafe(hard,maximum:16000000,expectedUID:getuid()),"hardlink metadata accepted")
var over=st;over.st_size=16000001
require(!Sut.nativeMetadataFileIsSafe(over,maximum:16000000,expectedUID:getuid()),"oversize metadata accepted")
let hardpath=root.appendingPathComponent("hard.jsonl");try FileManager.default.linkItem(at:file,to:hardpath)
require(Sut.readNativeMetadata(file.path)==nil,"actual hardlink accepted");try FileManager.default.removeItem(at:hardpath)
let alias=root.appendingPathComponent("alias.jsonl");try FileManager.default.createSymbolicLink(at:alias,withDestinationURL:file)
require(Sut.readNativeMetadata(alias.path)==nil,"symlink accepted")
let fifo=root.appendingPathComponent("fifo.jsonl");require(mkfifo(fifo.path,0o600)==0,"fifo creation failed")
require(Sut.readNativeMetadata(fifo.path)==nil,"FIFO accepted or blocked")
let dir=root.appendingPathComponent("dir.jsonl");try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:false)
require(Sut.readNativeMetadata(dir.path)==nil,"directory accepted")
try FileManager.default.setAttributes([.posixPermissions:0o777],ofItemAtPath:root.path)
require(Sut.readNativeMetadata(file.path)==nil,"writable parent admitted")
try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:root.path)
require(Sut.readNativeMetadata(file.path)==bytes,"safe file not restored")
print("Native metadata custody: \(checks) exact-source checks PASS; private reader unchanged; model/native/RPC/GUI calls0")
'''
with tempfile.TemporaryDirectory(prefix='os1-native-metadata-custody-pure-')as d:
 d=pathlib.Path(d);swift=d/'main.swift';swift.write_text(code);binary=d/'fixture'
 subprocess.run(['swiftc',str(swift),'-o',str(binary)],check=True)
 subprocess.run([str(binary),str(d/'fixtures')],check=True,timeout=15)
