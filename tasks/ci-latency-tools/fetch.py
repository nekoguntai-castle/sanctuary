import json,glob,os,sys,urllib.request,concurrent.futures as cf
from datetime import datetime
S=sys.argv[1]; API="https://forgejo.tabineko.dev/api/v1/repos/nekoguntai-castle/sanctuary"; TOK=os.environ['FORGEJO_TOKEN']
def get(u,raw=False):
    rq=urllib.request.Request(API+u,headers={"Authorization":"token "+TOK})
    b=urllib.request.urlopen(rq,timeout=120).read()
    return b if raw else json.loads(b)
runs=[]
for f in glob.glob(f"{S}/runs/p*.json"): runs+=json.load(open(f))['workflow_runs']
cut=datetime.fromisoformat(os.environ.get("CI_LATENCY_SINCE","2026-09-30T18:00:00-10:00"))
sel=[r for r in runs if r['status']=='success' and r['trigger_event'] in('pull_request','push','schedule') and datetime.fromisoformat(r['created'])>=cut]
os.makedirs(f"{S}/logs",exist_ok=True)
def work(r):
    try:
        jobs=get(f"/actions/runs/{r['id']}/jobs")
    except Exception as e: return
    json.dump({'run':{k:r[k] for k in('id','workflow_id','trigger_event','created','stopped','commit_sha','title')},'jobs':jobs},open(f"{S}/logs/run-{r['id']}.json","w"))
    for j in jobs:
        p=f"{S}/logs/job-{j['id']}.log"
        if os.path.exists(p) or j['status'] in('skipped',): continue
        try: open(p,'wb').write(get(f"/actions/jobs/{j['id']}/logs",raw=True))
        except Exception as e: pass
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(work,sel))
print(len(sel))
