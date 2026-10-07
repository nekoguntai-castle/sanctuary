import json,glob,re,os,sys,statistics as st
from datetime import datetime,timezone
S=sys.argv[1]
def ts(l):
    m=re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d+)Z',l)
    return datetime.fromisoformat(m.group(1)+'+00:00') if m else None
out=[]
for rf in glob.glob(f"{S}/logs/run-*.json"):
    d=json.load(open(rf)); r=d['run']; c=datetime.fromisoformat(r['created'])
    for j in d['jobs']:
        p=f"{S}/logs/job-{j['id']}.log"
        if not os.path.exists(p): continue
        L=open(p,errors='replace').read().splitlines()
        t=[x for x in (ts(l) for l in L[:3]+L[-3:]) if x]
        if len(t)<2: continue
        host=next((l.split('Name:')[1].strip() for l in L if ' Name: ' in l),'?')
        notes=[(m.group(1),int(m.group(2))) for l in L for m in [re.search(r'CI timing::(.*?) completed in .*\((\d+)s\)',l)] if m]
        out.append(dict(run=r['id'],wf=r['workflow_id'],ev=r['trigger_event'],job=j['name'],host=host,
            start=(t[0]-c).total_seconds()/60,end=(t[-1]-c).total_seconds()/60,dur=(t[-1]-t[0]).total_seconds()/60,notes=notes,status=j['status']))
json.dump(out,open(f"{S}/jobs.json","w"))
agg={}
for o in out:
    if o['ev']!='pull_request': continue
    agg.setdefault((o['wf'],re.sub(r'\(shard \d/\d\)|\d/\d','N',o['job'])),[]).append(o)
for k in sorted(agg):
    v=agg[k]; d=[x['dur'] for x in v]; s=[x['start'] for x in v]; e=[x['end'] for x in v]
    if st.median(d)<1.0: continue
    print(f"{k[0][:14]:14} {k[1][:58]:58} n={len(v):3} dur={st.median(d):5.1f}/{max(d):5.1f} start={st.median(s):5.1f} end={st.median(e):5.1f}")
