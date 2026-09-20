# homelab

My homelab, managed with GitOps. [Flux](https://fluxcd.io/) watches this repo and
reconciles everything into the cluster — there is nothing to `kubectl apply` by hand.

## Layout

```
clusters/rezo-lab/     Flux entrypoint for the rezo-lab management cluster
  flux-system/         FluxInstance (flux-operator) — what Flux itself runs as
  infrastructure.yaml  \
  capi-providers.yaml   >  the three Flux Kustomizations, chained with dependsOn
  apps.yaml            /
infrastructure/        cluster-level plumbing: CNI, storage, ingress, CAPI operator
capi-providers/        Cluster API provider CRs (split out; see below)
apps/                  the actual workloads
```

`clusters/rezo-lab` is the only path Flux is pointed at. Everything else is pulled
in from there:

```
infrastructure  ──►  capi-providers  ──►  apps
```

Each arrow is a `dependsOn` with `wait: true`, so a stage only starts once the
previous one is fully Ready.

## The management cluster

`rezo-lab` is a single-node [Talos](https://www.talos.dev/) cluster on the home LAN
(`192.168.25.0/24`, internal domain `rezoreyz.lan`). Its machine config lives in a
separate repo (`my-talos`) — this one starts at the point where Flux is already
running.

| | |
|---|---|
| Flux sync | `https://github.com/rezachalak/homelab`, `main`, every 1m |
| LoadBalancer pool | `192.168.25.100`–`192.168.25.105` (Cilium LB-IPAM + L2 announcements) |
| `.100` | Blocky — LAN DNS (TCP + UDP share the IP via `sharing-key`) |
| `.101` | Cilium Gateway — HTTP for `*.rezoreyz.lan` |

## infrastructure/

| Component | Version | Notes |
|---|---|---|
| `local-path-provisioner` | chart from git `main` | default StorageClass, backed by `/var/mnt/data` (the dedicated 322GB disk provisioned as a Talos user volume) |
| `gateway-api-crds` | v1.6.1 | standard CRDs, pulled straight from upstream |
| `cilium` | 1.20.x | CNI, kube-proxy replacement via Talos KubePrism (`localhost:7445`), L2 announcements, Gateway API, Hubble relay + UI |
| `gateway` | — | the `Gateway` on `.101` plus the `hubble.rezoreyz.lan` route |
| `metrics-server` | latest | `--kubelet-insecure-tls` |
| `cloudflared` | image `2026.8.2` | remotely-managed tunnel, 2 replicas |
| `cert-manager` | v1.21.2 | prerequisite for the CAPI operator |
| `cluster-api-operator` | 0.29.0 | plus [ORC](https://github.com/k-orc/openstack-resource-controller) v2.4.0, required by CAPO ≥ v0.12 |

## capi-providers/

The Cluster API provider CRs live in their own top-level Kustomization rather than
next to the operator's HelmRelease. Flux applies one Kustomization as a single
sorted batch, so keeping the CRs beside the release that installs their CRDs is a
chicken-and-egg dry-run failure. Splitting them lets `dependsOn` order the two.

| Provider | Version |
|---|---|
| CoreProvider `cluster-api` | v1.12.11 |
| InfrastructureProvider `openstack` | v0.14.8 |
| BootstrapProvider `talos` | v0.6.12 |
| ControlPlaneProvider `talos` | v0.5.13 |

The Talos providers aren't names the operator resolves on its own, so they carry an
explicit `fetchConfig` pointing at siderolabs' release manifests.

## apps/

**`blocky`** — LAN DNS on `192.168.25.100`. DoH upstreams (Quad9, Cloudflare) with
`parallel_best`, StevenBlack's list for ad blocking, and a `customDNS` entry mapping
`rezoreyz.lan` to the gateway. Blocky has no runtime-mutable state, so the config
block in `release.yaml` is the actual source of truth.

**`talos-lab-cluster`** — a workload Talos cluster (`talos-lab`, Kubernetes v1.32.4,
Talos v1.13.10) provisioned on OpenStack through Cluster API: 1 control-plane node
(`m1.medium`) and 1 worker (`m1.small`). The target is a DevStack without Octavia,
so there's no managed API server load balancer — CAPO assigns a floating IP directly
to the control-plane node instead. Security-group rules open the Kubernetes API
(`6443`) and the Talos API (`50000`) to the home LAN only.

## Secrets

Nothing sensitive is committed. Two Secrets are created out of band and referenced
from the manifests:

| Secret | Namespace | Used by |
|---|---|---|
| `cloudflared-token` | `cloudflared` | tunnel token, injected via `valuesFrom` at render time |
| `talos-lab-cloud-config` | `talos-lab-cluster` | OpenStack `clouds.yaml` for CAPO |

## License

Apache 2.0 — see [LICENSE](LICENSE).
