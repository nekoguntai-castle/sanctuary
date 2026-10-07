import json,sys,re,statistics as st
S=sys.argv[1]; J=json.load(open(f"{S}/jobs.json"))
needs={}; name2key={}
for l in open(f"{S}/needs.tsv"):
    wf,k,n,nd=(l.rstrip('\n').split('\t')+[''])[:4]
    nd=[x.strip() for x in re.sub(r'[\[\]]','',nd).replace(',',' ').split() if x.strip()]
    needs[(wf,k)]=nd
    name2key[(wf,re.sub(r'\$\{\{.*?\}\}','*',n))]=k
def key(wf,name):
    for (w,pat),k in name2key.items():
        if w!=wf: continue
        if re.fullmatch(re.escape(pat).replace(r'\*','.*'),name): return k
    return None
runs={}
for j in J: runs.setdefault(j['run'],[]).append(j)
Q={}; allq=[]
for r,v in runs.items():
    wf=v[0]['wf']
    if v[0]['ev']!='pull_request': continue
    ends={}
    for j in v:
        k=key(wf,j['job']); j['key']=k
        ends[k]=max(ends.get(k,0),j['end'])
    for j in v:
        k=j['key']
        if k is None: continue
        nd=needs.get((wf,k),[])
        ready=max([ends[n] for n in nd if n in ends],default=0)
        q=j['start']-ready
        Q.setdefault((wf,k),[]).append(q); allq.append(q)
def p(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))]
print(f"ALL jobs: n={len(allq)} queue med={st.median(allq):.2f} p90={p(allq,.9):.2f}")
for k,v in sorted(Q.items(),key=lambda x:-st.median(x[1])):
    if len(v)>=3: print(f"  {k[0][:14]:14} {k[1][:42]:42} n={len(v):3} queue med={st.median(v):5.2f} p90={p(v,.9):5.2f} max={max(v):5.2f}")
