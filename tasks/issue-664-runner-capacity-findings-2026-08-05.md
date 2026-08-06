## Runner capacity model and a measurement from x300

Investigating whether the runner can absorb parallel upgrade lanes. Short version: **slots are not resource-aware, the per-job limits do not bound what these lanes actually consume, and the binding constraint on x300 is disk IO rather than memory.** That last point changes the prerequisite list.

### 1. `runner.capacity` is a job counter, not a resource budget

Forgejo's `act_runner` has no weighting, no bin-packing, and no resource-aware scheduling. A 63-minute upgrade lane and an `echo hello` each consume exactly one of `RUNNER_CAPACITY=3`. There is no mechanism by which an expensive job takes two slots.

### 2. The per-job limits do not bound these lanes

`bootstrap-forgejo-runner-host.sh:245` applies the `JOB_*` profile through `container.options`:

```
options: "--memory=6g --memory-swap=7g --pids-limit=1024 --cpus=4"
```

That cgroup covers the act job container only — its shell, node, npm. The upgrade lanes point `DOCKER_HOST` at the DIND daemon, so every Compose stack they bring up is a **sibling** of the job container, not a child. Postgres, backend, worker, frontend, gateway and egress-proxy all land outside the 6g slot limit. The only envelope those stacks actually sit inside is DIND's own cgroup (`DIND_CPUS=12`, `DIND_MEMORY=22g`).

So "one slot" does not correspond to a bounded footprint, which is worth stating explicitly in this issue because it means capacity tuning alone cannot make parallelism safe.

### 3. Host capacity

x300: **27.3 GiB RAM, 16 cores, 48 GiB swap.**

| | RAM | CPU |
|---|---|---|
| `DIND_MEMORY` / `DIND_CPUS` | 22 GiB | 12 |
| `RUNNER_MEMORY` / `RUNNER_CPUS` | 2 GiB | 2 |
| **committed** | **24 GiB** | **14** |
| host total | 27.3 GiB | 16 |

Raising `DIND_MEMORY` is not available as a lever — 22 GiB of 27.3 GiB is already aggressive, and the ~3.3 GiB remainder is the host's working margin. As it turns out this does not matter, because memory is not what limits us.

### 4. Measurement under real 2-way concurrency

Sampled with two jobs live (`Auth-Flow` + `Upgrade-Baseline`) plus a buildkit builder:

```
Mem:  27Gi total   4.1Gi used   19Gi buff/cache   23Gi available
Swap: 48Gi total   209Mi used

memory.events:  low 0  high 0  max 0  oom 0  oom_kill 0

memory pressure:  some avg10=0.00   full avg10=0.00    total=48.5 s
io pressure:      some avg10=51.56  full avg10=51.25   total=18,048 s
```

**Memory is not the constraint.** Two concurrent jobs use 4.1 GiB of anonymous memory against 23 GiB available, with zero reclaim events and no OOM history. A ceiling-based estimate — 6g job limit plus ~5.6 GiB of `docker-compose.yml` service limits, ≈11.6 GiB per lane — suggests two lanes would exceed the 22 GiB DIND envelope, but that is ceiling arithmetic and the measurement contradicts it. Real per-lane usage is far below the configured limits.

**Disk IO is the constraint.** `full avg10=51.25` means every task on the host was stalled on IO for ~51% of the preceding ten seconds, with 16 cores otherwise idle. Cumulatively since boot: **5.0 hours of full IO stall versus 48 seconds for memory**, a ratio of roughly 370:1.

This is the most likely explanation for `Upgrade Baseline` taking 63 minutes on `v0.8.59-rc1`, and it predicts that parallelism yields little: concurrent image builds, layer extraction, and Postgres fsyncs contend for the same device. Additional lanes convert into additional stall, which is precisely the timeout-flake signature described here from before v0.8.52.

It also explains why the historical failure mode reads as timeouts and false reds rather than OOM kills. With 48 GiB of swap and only ~3 GiB of it reachable by DIND, this host degrades by thrashing, never by running out of memory — so an absence of OOM evidence in past investigations was never evidence of headroom.

### 5. Cross-runner concurrency — the heavy lanes cannot use it today

The org has three registered runners:

| runner | status | version | labels |
|---|---|---|---|
| `x300-docker-runner` | active | v13.0.0 | `ubuntu-latest`, `ubuntu-22.04`, `ubuntu-20.04`, **`x300-canary`**, `playwright-x300-canary`, `playwright-1.61.1` |
| `kumo` | idle | v13.0.0 | `docker`, `ubuntu-latest`, `ubuntu-22.04`, `ubuntu-20.04`, `playwright-kumo-canary`, `playwright-1.61.1` |
| `archetype-docker-runner` | offline | v12.10.1 | `ubuntu-latest`, `ubuntu-22.04`, `ubuntu-20.04`, `playwright-1.61.1` |

Every heavy lane in `install-test.yml` is pinned to `runs-on: [ubuntu-22.04, x300-canary]` — `fresh-install-test`, `install-script-test`, `install-stack-smoke`, `container-health-test`, `auth-flow-test`, all three `upgrade-*` lanes, and `docker-resource-cleanup`. Only `determine-scope`, `unit-tests` and `test-summary` use bare `ubuntu-22.04`. There are 12 such pins across `install-test.yml` and `release-candidate.yml`.

`kumo` does not carry `x300-canary`, so **it can never receive an upgrade lane**. Cross-runner concurrency already happens today, but only for the three light jobs. The entire heavy chain is single-host by construction, which is why the IO ceiling on x300 is the whole story for this issue.

#### This is the most promising path, because it dissolves two blockers rather than solving them

Running two heavy lanes on two *different hosts* avoids both problems this issue is gated on:

- **The per-lane image tag race disappears.** `sanctuary-backend:local` and friends collide because lanes share one Docker daemon. Two hosts have two daemons and two independent image caches, so there is no tag to race over. The namespacing work described under "Per-lane image tags (hard blocker)" is only required for *same-host* concurrency.
- **The IO contention disappears.** Separate hosts, separate disks.

And `scripts/ci/with-runner-lock.sh` already has exactly the right semantics for this topology, for free: `flock` on a host-local path serializes lanes *within* a host while placing no constraint *across* hosts. Wrapping the heavy lanes in one shared lock name yields "at most one heavy lane per host, N hosts in parallel" with no new machinery.

The corresponding limitation is worth stating plainly: a host-local `flock` **cannot** coordinate across runners. It is the right tool for capping per-host concurrency and the wrong tool for any global budget.

#### What blocks it

Per `runner-infra/docs/how-to/forgejo-runner-host.md`, **kumo runs a rootless Podman runner, not the Docker-in-Docker stack**, and the doc explicitly says not to apply the DIND profile there without an approved migration. So kumo is not a drop-in second heavy host. Qualifying it means either migrating it to DIND, or validating these lanes under rootless Podman — where the privileged and bind-mount semantics differ enough that #660's DIND filesystem-sharing problem may not transfer in the same form. The doc's four-gate promotion checklist would also apply, and kumo's CPU/RAM/disk are unknown (there is no `config/runner-hosts/kumo.env`, and the host did not resolve by name from my environment).

### 6. Revised prerequisite ordering

Amending the list in the issue body:

1. **#660** — blocking the gate today (unchanged)
2. **IO capacity assessment on x300 — new.** Establish what device backs `/var/lib/docker` and whether it is rotational. If these lanes are building images on a spinning disk, moving that volume to NVMe would cut more wall-clock than parallelism could, without introducing any of the race classes this issue is about. This is the cheapest available win and it is worth doing regardless of what happens with concurrency.
3. **Decide the concurrency axis — cross-host or same-host.** These have different prerequisites and the choice determines everything downstream:
   - **Cross-host** (preferred): qualify a second heavy runner. Needs the kumo Podman/DIND decision, its host specs, and the promotion checklist. Does **not** need per-lane image tags.
   - **Same-host**: needs per-lane image tags and the scoped cleanup audit first, and runs into the IO ceiling measured above.
4. **Per-lane image tags** — still worth doing for correctness on its own merits (#659 was a serial failure), but it is a prerequisite only for the same-host path.
5. **Scoped cleanup audit** — likewise.
6. **Then** parallelism, capped by `with-runner-lock.sh` and gated on IO pressure rather than memory headroom.

On item 4 in the original list ("Capacity"): `DIND_MEMORY` should be left where it is. It is neither the limit nor worth raising, and the measurement shows the memory envelope is comfortable even at 2-way concurrency.

The broader shift is that the original issue frames this as "make the lanes run concurrently on the runner." The measurements suggest the better framing is "give the lanes a second disk" — either by moving x300's Docker volume to faster storage, or by qualifying a second host. Same-host parallelism is the option that requires the most prerequisite work and delivers the least, because it is contending for the resource that is already saturated.

### Addendum — the cross-host path is harder than section 5 implies

Posted as a follow-up comment on #664. Correcting section 5: the `x300-canary` pin is **not** relaxable scheduling preference, it is a capability requirement.

`docs/reference/ci-cd-strategy.md:334-337` states that the label selects the DIND runner "whose daemon socket can be mounted into the production `docker-proxy` service; rootless Podman runners cannot satisfy that compose contract." Confirmed at `docker-compose.yml:779`, where `tecnativa/docker-socket-proxy` bind-mounts `/var/run/docker.sock:ro`. Rootless Podman has no such socket — it lives under `$XDG_RUNTIME_DIR/podman/` with different ownership and API semantics.

So cross-host parallelism needs a second **DIND** host, not merely a second runner. Adding `x300-canary` to kumo would produce lanes that fail on the compose contract.

**Why kumo is Podman: no recorded rationale exists.** The only primary source is `runner-infra/docs/how-to/forgejo-runner-host.md:245-247`, which states the fact and a guardrail without a reason. Searched runner-infra git history, Sanctuary `docs/`/`tasks/`/`reports/`, and the notes vault — nothing. Also unrecorded: kumo's hardware, OS, role, multi-tenancy, and whether Podman was security-motivated. The guardrail is a gate, not a rejection; migration has never been decided against.

Option ranking after this correction:

| option | unblocks parallelism? | prerequisites |
|---|---|---|
| Faster storage on x300 (#666) | no, but may make it unnecessary | none — measurement only |
| Second DIND host | yes, cleanly | kumo migration decision + specs + promotion, or a new host |
| Migrate kumo to DIND | yes | approval; rationale for Podman unknown |
| Make `docker-proxy` rootless-compatible | yes, unlocks kumo as-is | changes a production contract to serve CI — likely wrong trade |
| Same-host concurrency on x300 | marginally | image tags + scoped cleanup, into a ~51% IO-stalled device |

### Open items

- The DIND cgroup path resolved to the `/init` sub-scope, where `memory.max = max`. **`DIND_MEMORY=22g` has not been confirmed as actually applied** at the parent scope — worth verifying independently of this issue, since an unenforced limit would mean there is no envelope at all.
- The `memory.peak 16GB` / `memory.current 13GB` readings on that sub-scope include page cache (the host reported only 4.1 GiB used at the same moment) and should not be read as real footprint.
- The IO finding is a single sample under a 2-job mix that included one upgrade lane, not two. Storage device type is not yet confirmed.
