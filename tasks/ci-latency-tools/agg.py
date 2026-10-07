import json,glob,os,statistics as st
from datetime import datetime
runs=[]
for f in glob.glob(f"{__import__('sys').argv[1]}/runs/p*.json"):
    runs+=json.load(open(f))['workflow_runs']
def t(s): return datetime.fromisoformat(s)
cut=t(os.environ.get("CI_LATENCY_SINCE","2026-09-30T18:00:00-10:00"))
rows={}
for r in runs:
    if r['status']!='success': continue
    d=(t(r['stopped'])-t(r['created'])).total_seconds()/60
    era='after' if t(r['created'])>=cut else 'before'
    ev=r['trigger_event']
    rows.setdefault((r['workflow_id'],ev,era),[]).append(d)
def p(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))]
for k in sorted(rows):
    v=rows[k]; print(f"{k[0]:24} {k[1]:14} {k[2]:6} n={len(v):3} med={st.median(v):6.1f} p90={p(v,.9):6.1f} max={max(v):6.1f}")
from collections import Counter
print(Counter((r['status']) for r in runs))
print(Counter((r['trigger_event'],r['status']) for r in runs if t(r['created'])>=cut))
