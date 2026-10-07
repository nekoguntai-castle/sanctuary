# Time from first workflow creation to the last required workflow finishing, per PR head SHA.
import json,glob,os,sys,statistics as st,collections
from datetime import datetime
S=sys.argv[1]; runs=[]
for f in glob.glob(f"{S}/runs/p*.json"): runs+=json.load(open(f))['workflow_runs']
cut=datetime.fromisoformat(os.environ.get("CI_LATENCY_SINCE","2026-09-30T18:00:00-10:00"))
by=collections.defaultdict(dict)
for r in runs:
    if r['trigger_event']!='pull_request' or datetime.fromisoformat(r['created'])<cut: continue
    by[r['commit_sha']][r['workflow_id']]=r
req=['quality.yml','test.yml','verify-vectors.yml']
T=[];last=collections.Counter()
for sha,w in by.items():
    if not all(k in w and w[k]['status']=='success' for k in req): continue
    t0=min(datetime.fromisoformat(r['created']) for r in w.values())
    ends={k:(datetime.fromisoformat(w[k]['stopped'])-t0).total_seconds()/60 for k in req}
    T.append(max(ends.values())); last[max(req,key=ends.get)]+=1
print("PR SHAs",len(T),"required-green median",round(st.median(T),1) if T else None,"max",round(max(T),1) if T else None); print("last required:",dict(last))
