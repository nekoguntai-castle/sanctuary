# CI latency measurement tools (scratch, read-only)

Used for `tasks/ci-speedup-analysis-2026-10-05.md` and the acceptance checks in
`tasks/ci-speedup-round3-plan-2026-10-05.md`. All calls are GET-only.

```bash
source ~/.bashrc                       # FORGEJO_TOKEN
export CI_LATENCY_SINCE=2026-10-06T00:00:00-10:00   # start of the window to measure
OUT=$(mktemp -d)                       # or a scratchpad dir
API=https://forgejo.tabineko.dev/api/v1/repos/nekoguntai-castle/sanctuary
mkdir -p $OUT/runs
for p in $(seq 1 12); do curl -fsS -H "Authorization: token $FORGEJO_TOKEN" "$API/actions/runs?limit=50&page=$p" > $OUT/runs/p$p.json; done
python3 agg.py $OUT          # workflow wall-clock by event, before/after the window start
python3 reqgreen.py $OUT     # time to required-green per PR head SHA, and which check finished last
python3 fetch.py $OUT        # job lists + job logs for successful runs in the window (slow)
python3 jobs.py $OUT         # per-job duration/start/end table -> $OUT/jobs.json
# needs graph from the workflows of the commit being measured:
for wf in test.yml verify-vectors.yml release-candidate.yml docker-build.yml install-test.yml quality.yml architecture.yml; do
  awk -v wf=$wf '/^jobs:/{j=1;next} j&&/^  [a-zA-Z0-9_-]+:$/{if(k)print wf"\t"k"\t"n"\t"nd; k=$1; sub(/:$/,"",k); n=k; nd=""} j&&/^    name:/{sub(/^    name: */,"");n=$0} j&&/^    needs:/{sub(/^    needs: */,""); nd=$0; if(nd==""){while((getline line)>0 && line ~ /^      - /){sub(/^      - /,"",line); nd=nd" "line}}} END{print wf"\t"k"\t"n"\t"nd}' ../../.github/workflows/$wf
done > $OUT/needs.tsv
python3 job_queue.py $OUT        # queue = job start - latest needs end
```

Host snapshots (root-only on each runner host): copy `snap.awk` (load/PSI/memory by job count),
`snap2.awk` (task IDs per snapshot) or `snap3.awk` (task ID -> job name) to the host and run it
over `sudo find /var/lib/forgejo-runner-health/snapshots -newermt '<start>'`, as in the report.
