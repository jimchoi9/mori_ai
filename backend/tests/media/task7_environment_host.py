"""Host orchestration only; all application/fixture memory is Docker constrained.
No inherited environment, published ports, external network, or named QA volume.
"""
import concurrent.futures, hashlib, json, os, pathlib, subprocess, sys, tempfile, time
REPO=pathlib.Path(__file__).resolve().parents[3]
IMAGE=os.environ.get('MORI_VERIFY_TEST_IMAGE','mori-ai:ai-tests')
LIMITS={'db':256,'web':384,'proxy':128,'worker':1024,'driver':128}
if os.environ.get('TASK7_MEMORY_DIAGNOSTICS') == '1':
    # Diagnostic-only client headroom after observed driver OOM; 1984MiB total.
    # Product services/worker limits and ordinary acceptance runs are unchanged.
    LIMITS['driver']=192
CPUS={'db':'.25','web':'.4','proxy':'.1','worker':'1.1','driver':'.15'}
OUT=pathlib.Path(tempfile.mkdtemp(prefix='mori-task7-environment-'))
PREFIX=f'mori-task7-{os.getpid()}-{int(time.time())}'
MODULE='backend.tests.media.mixed_environment_probe'

def docker(*args,check=True):
    p=subprocess.run(['docker',*map(str,args)],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if check and p.returncode: raise RuntimeError(f'docker {args[:3]}: {p.stderr}')
    return p

def sample(name):
    started=time.time()
    p=docker("exec",name,"sh","-c","cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.current /sys/fs/cgroup/memory.swap.max; cat /proc/[0-9]*/status 2>/dev/null | awk '/^VmRSS:/ {sum+=$2} END {printf \"%.0f\\n\", sum*1024}'; cat /sys/fs/cgroup/memory.events; cat /sys/fs/cgroup/memory.stat",check=False)
    if p.returncode: return None
    lines=p.stdout.splitlines(); keys=['current','peak','limit','swap','swap_limit']
    result={k:int(v) for k,v in zip(keys,lines[:5])}; result['process_rss_sum']=int(lines[5])
    extra=dict(line.split() for line in lines[6:]); result['anon']=int(extra['anon'])
    result['events']={k:int(extra[k]) for k in ('max','oom','oom_kill')}
    result['started']=started; result['finished']=time.time()
    return result

def run(slots):
    root=OUT/str(slots); root.mkdir(); names={role:f'{PREFIX}-{slots}-{role}' for role in LIMITS}; network=f'{PREFIX}-{slots}'
    env={'DATABASE_URL':'postgresql+asyncpg://mori:offline-task7@db:5432/mori_task7','APP_ENV':'local','DEV_AUTH_ENABLED':'true','SESSION_COOKIE_ALLOW_INSECURE_LOCAL':'true','APP_ORIGIN':'http://proxy:8000','AI_REAL_CALLS_ENABLED':'true','OPENAI_API_KEY':'offline-task7-not-a-credential','STORAGE_MODE':'local','STORAGE_ROOT':'/media','WORKER_POLL_SECONDS':'1','TASK7_SLOTS':str(slots),'TASK7_CYCLES':os.environ.get('TASK7_CYCLES','4')}
    created=[]
    if os.environ.get('TASK7_MEMORY_DIAGNOSTICS') == '1':
        env['TASK7_MEMORY_DIAGNOSTICS']='1'
    try:
        docker('network','create','--internal',network)
        media=f'{network}-media'; dbvol=f'{network}-db'
        docker('volume','create',media); docker('volume','create',dbvol)
        def start(role,command=None):
            args=['run','-d','--pull','never','--platform','linux/amd64','--name',names[role],'--network',network,'--network-alias',role,'--memory',f'{LIMITS[role]}m','--memory-swap',f'{LIMITS[role]}m','--cpus',CPUS[role],'--pids-limit','128','-v',f'{root}:/results:rw']
            if role=='db':
                args+=['-v',f'{dbvol}:/var/lib/postgresql/data','-e','POSTGRES_USER=mori','-e','POSTGRES_PASSWORD=offline-task7','-e','POSTGRES_DB=mori_task7','postgres:17-bookworm','postgres','-c','shared_buffers=32MB','-c','max_connections=40']
            else:
                args+=['-v',f'{REPO}/backend:/app/backend:ro','-v',f'{media}:/media:rw','-w','/app']
                for k,v in env.items(): args+=['-e',f'{k}={v}']
                args+=[IMAGE]+(command or ['python','-m',MODULE,role])
            docker(*args); created.append(role)
        start('db')
        for _ in range(90):
            if docker('exec',names['db'],'pg_isready','-h','127.0.0.1','-U','mori','-d','mori_task7',check=False).returncode==0: break
            time.sleep(1)
        # Same constrained worker container prepares fixtures/migrations before measurement.
        start('worker',['sh','-c',f'python -m alembic -c backend/alembic.ini upgrade head && python -m {MODULE} fixtures'])
        if docker('wait',names['worker']).stdout.strip()!='0': raise RuntimeError(docker('logs',names['worker']).stdout)
        hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.suffix in ('.webp','.png','.jpg')}
        (root/'fixtures.json').write_text(json.dumps(hashes,indent=2))
        docker('rm',names['worker']); created.remove('worker')
        start('web'); start('proxy'); start('worker'); start('driver')
        started=time.time(); samples=[]; last={}; success=False
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool, (root/'samples.jsonl').open('w') as f:
            while time.time()-started<(2400 if env.get('TASK7_MEMORY_DIAGNOSTICS') else 1200):
                rows=dict(zip(names,pool.map(sample,names.values())))
                if not all(rows.values()): break
                last=rows; phase=(root/'phase').read_text() if (root/'phase').exists() else 'startup'
                record={'timestamp':time.time(),'phase':phase,'sample_skew_seconds':max(x['finished'] for x in rows.values())-min(x['started'] for x in rows.values()),'roles':rows,'sum_current':sum(x['current'] for x in rows.values()),'sum_anon':sum(x['anon'] for x in rows.values()),'sum_process_rss':sum(x['process_rss_sum'] for x in rows.values())}
                samples.append(record); f.write(json.dumps(record)+'\n'); f.flush()
                state=json.loads(docker('inspect',names['driver']).stdout)[0]['State']
                if not state['Running']:
                    success=state['ExitCode']==0; break
                time.sleep(.2)
        state=json.loads(docker('inspect',names['driver']).stdout)[0]['State']
        success=not state['Running'] and state['ExitCode']==0
        if not samples: raise RuntimeError('no cgroup samples')
        provider=json.loads((root/'provider.json').read_text()) if (root/'provider.json').exists() else {}
        idle={phase:[x for x in samples if x['phase']==phase] for phase in ('idle-0','idle-1','idle-2','idle-3')}
        idle_anon={k:min(x['sum_anon'] for x in v) for k,v in idle.items() if v}
        idle_rss={k:min(x['sum_process_rss'] for x in v) for k,v in idle.items() if v}
        rss_drift=max((v/idle_rss['idle-0']-1 for k,v in idle_rss.items() if k!='idle-0'),default=None) if len(idle_rss)==4 else None
        drift=(idle_anon.get('idle-3',0)/idle_anon['idle-0']-1) if 'idle-0' in idle_anon and 'idle-3' in idle_anon else None
        peak_sum=max(x['sum_current'] for x in samples); service_peak_sum=sum(x['peak'] for x in last.values()); worker_peak=last['worker']['peak']
        checks={'workload_completed':success,'hard_limits_match':all(r['limit']==LIMITS[k]*1024**2 for k,r in last.items()),'services_still_running':all(json.loads(docker('inspect',name).stdout)[0]['State']['Running'] for role,name in names.items() if role!='driver'),'no_container_oom':all(not json.loads(docker('inspect',name).stdout)[0]['State']['OOMKilled'] for name in names.values()),'provider_image_peak_reached':provider.get('peaks',{}).get('image')==slots,'goods_album_overlap':provider.get('peaks',{}).get('mixed_overlap')==1,'expected_provider_calls':provider.get('calls')=={'image':int(env['TASK7_CYCLES'])*10,'caption':int(env['TASK7_CYCLES'])*12,'goods':int(env['TASK7_CYCLES'])},'no_pressure_events':all(not any(r['events'].values()) for r in last.values()),'no_swap':all(r['swap']==0 and r['swap_limit']==0 for r in last.values()),'worker_under_80_percent':worker_peak<=.8*1024**3,'total_sampled_under_80_percent':peak_sum<=.8*2*1024**3,'total_conservative_under_80_percent':service_peak_sum<=.8*2*1024**3,'idle_rss_drift_under_10_percent':rss_drift is not None and rss_drift<=.1}
        result={'slots':slots,'cycles':int(env['TASK7_CYCLES']),'limits_mib':LIMITS,'total_limit_mib':sum(LIMITS.values()),'cpus':CPUS,'elapsed_seconds':time.time()-started,'sampled_sum_peak':peak_sum,'conservative_service_peak_sum':service_peak_sum,'worker_peak':worker_peak,'idle_anon':idle_anon,'idle_anon_drift':drift,'idle_process_rss_sum':idle_rss,'max_idle_process_rss_drift':rss_drift,'provider':provider,'last_cgroup':last,'checks':checks,'passed':all(checks.values()),'scope':'12 album pages (6 paired, 6 single) + goods creation per cycle; while SDK image lanes active add goods 12MP upload and album 12MP validation. First cycle warmup, mocked SDK transport, not 30min/50photos, no legacy v2 larger inputs; idle-0 is warmup baseline, idle-1/2/3 are three subsequent cycles; process RSS sum double-counts shared pages; host OS/Docker overhead outside 1920MiB cap'}
        (root/'summary.json').write_text(json.dumps(result,indent=2)); print(json.dumps(result),flush=True)
        return result
    finally:
        for role in reversed(created):
            logs=docker('logs',names[role],check=False); (root/f'{role}.log').write_text(logs.stdout+logs.stderr)
            info=docker('inspect',names[role],check=False); (root/f'{role}.inspect.json').write_text(info.stdout)
            docker('rm','-f',names[role],check=False)
        docker('network','rm',network,check=False)
        docker('volume','rm',f'{network}-media',f'{network}-db',check=False)

def main():
    print('Results:',OUT,flush=True)
    images={image:json.loads(docker('image','inspect',image).stdout)[0]['Id'] for image in (IMAGE,'postgres:17-bookworm')}
    sources={str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((REPO/'backend').rglob('*.py'))}
    sources['scripts/verify-media-environment.sh']=hashlib.sha256((REPO/'scripts/verify-media-environment.sh').read_bytes()).hexdigest()
    (OUT/'manifest.json').write_text(json.dumps({'images':images,'sources_sha256':sources},indent=2))
    (OUT/'host.json').write_text(json.dumps({'uname':os.uname()._asdict() if hasattr(os.uname(),'_asdict') else list(os.uname()),'docker':docker('version','--format','{{json .}}').stdout,'note':'linux/amd64 containers may use emulation; CPU quota sums to 2.0; no OS-memory claim'},indent=2))
    results=[run(int(x)) for x in os.environ.get('TASK7_PROFILES','2,4').split(',')]
    (OUT/'summary.json').write_text(json.dumps(results,indent=2))
    if len(results)==2:
        a=json.loads((OUT/'2'/'fixtures.json').read_text()); b=json.loads((OUT/'4'/'fixtures.json').read_text())
        if a!=b: raise RuntimeError('fixtures differ')
    print('Results:',OUT,flush=True)
    return 0 if all(r['passed'] for r in results) else 1
if __name__=='__main__': sys.exit(main())
