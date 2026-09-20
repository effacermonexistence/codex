#!/usr/bin/env python3
"""Executed macOS launchd lifecycle tests; no model, credentials, or external sends."""
import json, os, pathlib, socket, subprocess, sys, tempfile, time, urllib.request
cli=os.path.abspath(sys.argv[1]); node=subprocess.check_output(['which','node'],text=True).strip()
checks=[]
def run(*args, ok=True):
    p=subprocess.run([cli,*args],capture_output=True,text=True,timeout=45)
    assert (p.returncode==0)==ok, (args,p.returncode,p.stdout,p.stderr)
    return p
with tempfile.TemporaryDirectory(prefix='os1-preview-test-') as tmp:
    root=pathlib.Path(tmp); (root/'index.html').write_text('<h1>OS1_PREVIEW_LIFETIME_OK</h1>')
    with socket.socket() as s: s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    url=f'http://127.0.0.1:{port}/'
    server=root/'server.cjs'; server.write_text("const http=require('http'),fs=require('fs');http.createServer((q,r)=>{if(q.url==='/redirect'){r.writeHead(302,{Location:'/'+ 'target'});return r.end()}if(q.url==='/target')fs.writeFileSync('redirect-followed','bad');r.end(fs.readFileSync('index.html'))}).listen(Number(process.argv[2]),'127.0.0.1')")
    args=['preview-start','--workspace',tmp,'--url',url,'--',node,str(server),str(port)]
    try:
        run(*args); checks.append('start_http_ready')
        time.sleep(2)
        assert b'OS1_PREVIEW_LIFETIME_OK' in urllib.request.urlopen(url).read()
        run('preview-status','--url',url); checks.append('survives_launcher_exit_second_process')
        run(*args); checks.append('idempotent_same_configuration')
        run(*args,'different',ok=False); checks.append('different_config_rejected')
        good=root/'good.txt'; good.write_text('OS1_PREVIEW_URL: '+url)
        run('preview-check-output',str(good)); checks.append('live_url_adoptable')
        good.write_text(url+'redirect'); run('preview-check-output',str(good),ok=False)
        assert not (root/'redirect-followed').exists(); checks.append('redirect_rejected_without_following')
        run('preview-start','--workspace',tmp,'--url','http://example.com:4173/','--',node,str(server),str(port),ok=False)
        checks.append('nonloopback_rejected')
        run('preview-stop','--url',url); run('preview-status','--url',url,ok=False)
        good.write_text(url); run('preview-check-output',str(good),ok=False)
        assert (root/'index.html').exists(); checks.append('stop_preserves_files_dead_url_rejected')
        foreign=subprocess.Popen([node,str(server),str(port)],cwd=tmp,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            time.sleep(1); run(*args,ok=False)
            assert foreign.poll() is None; checks.append('foreign_listener_preserved')
        finally: foreign.terminate(); foreign.wait(timeout=5)
    finally:
        subprocess.run([cli,'preview-stop','--url',url],capture_output=True)
        for suffix in ['.json','.lock','.stdout.log','.stderr.log']:
            (pathlib.Path.home()/'.os1/previews'/f'com.omaragi.os1.preview.{port}{suffix}').unlink(missing_ok=True)
print(json.dumps({'checks':checks,'count':len(checks),'status':'PASS'},indent=2))
