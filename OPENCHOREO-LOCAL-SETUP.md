# OpenChoreo Local Setup (k3d)

## Before anything else — clone the OpenChoreo repo

The Helm charts and k3d config files are local files inside the OpenChoreo repo — not published to a public Helm registry. You must clone the repo first:

```bash
git clone https://github.com/openchoreo/openchoreo.git
cd openchoreo
```

Keep this folder. Every install command below runs from inside it.

---

## Step 1 — Install k3d

k3d runs a full Kubernetes cluster inside Docker containers. You already have Docker Desktop, so k3d just needs a single binary:

```powershell
choco install k3d
# New terminal after install:
k3d version
```

**What k3d is:** Think of it as Minikube but lighter — it uses k3s (a minimal Kubernetes distribution) inside Docker. Starts in ~10 seconds, stops just as fast.

---

## Step 2 — Create the cluster

OpenChoreo ships a config file that pre-configures k3d exactly right (port mappings, disabled components, registry mirrors). Use it:

```bash
# Run from inside the openchoreo repo you cloned
k3d cluster create --config install/k3d/single-cluster/config.yaml
```

**What this config does:**

- Creates a cluster named `openchoreo`
- Exposes ports: `8080` (UI), `19080` (your workloads/APIs), `10081` (CI workflows), `11080` (observability)
- Disables Traefik (OpenChoreo uses its own gateway — kgateway)
- Sets up a local container registry on port `10082`
- Adds `host.k3d.internal` as a TLS SAN so control plane and data plane can talk

After this, `kubectl get nodes` should show one node Ready.

---

## Step 3 — Install dependencies (in order)

OpenChoreo is composed of smaller pieces. Install them in this exact order:

**Gateway API CRDs** — the standard Kubernetes API for HTTP routing:

```bash
kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.1/experimental-install.yaml
```

**cert-manager** — issues TLS certificates automatically inside the cluster:

```bash
helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.19.2 --set crds.enabled=true
```

**external-secrets** — syncs secrets from external stores (AWS Secrets Manager, etc.) into Kubernetes Secrets:

```bash
helm upgrade --install external-secrets oci://ghcr.io/external-secrets/charts/external-secrets \
  --namespace external-secrets --create-namespace \
  --version 1.3.2 --set installCRDs=true
```

**kgateway CRDs + kgateway** — the Envoy-based API gateway that OpenChoreo uses for routing:

```bash
helm upgrade --install kgateway-crds oci://cr.kgateway.dev/kgateway-dev/charts/kgateway-crds \
  --create-namespace --namespace openchoreo-control-plane --version v2.2.1

helm upgrade --install kgateway oci://cr.kgateway.dev/kgateway-dev/charts/kgateway \
  --namespace openchoreo-control-plane --create-namespace --version v2.2.1 \
  --set controller.extraEnv.KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true
```

**thunder** — the auth/identity layer (Asgardeo open source):

```bash
helm upgrade --install thunder oci://ghcr.io/asgardeo/helm-charts/thunder \
  --namespace openchoreo-control-plane --create-namespace \
  --version 0.23.0 --values install/k3d/common/values-thunder.yaml
```

**CoreDNS custom config** — makes `*.openchoreoapis.localhost` resolve inside the cluster:

```bash
kubectl apply -f install/k3d/common/coredns-custom.yaml
```

**Backstage secrets** — the developer portal needs signing keys:

```bash
kubectl create secret generic backstage-secrets -n openchoreo-control-plane \
  --from-literal=backend-secret="$(head -c 32 /dev/urandom | base64)" \
  --from-literal=client-secret="backstage-portal-secret" \
  --from-literal=jenkins-api-key="placeholder-not-in-use"
```

> **Windows note:** The `$(head -c 32 /dev/urandom | base64)` part requires Git Bash or WSL.
> Or replace it with any random string, e.g. `--from-literal=backend-secret="localdevsecret1234567890abcdef12"`

---

## Step 4 — Install OpenChoreo itself

**Control Plane** (the brain — manages components, routes, environments):

```bash
helm upgrade --install openchoreo-control-plane install/helm/openchoreo-control-plane \
  --namespace openchoreo-control-plane --create-namespace \
  --values install/k3d/single-cluster/values-cp.yaml
```

**Data Plane** (where your workloads actually run):

```bash
helm upgrade --install openchoreo-data-plane install/helm/openchoreo-data-plane \
  --dependency-update \
  --namespace openchoreo-data-plane --create-namespace \
  --values install/k3d/single-cluster/values-dp.yaml
```

---

## Step 5 — Verify

```bash
kubectl get pods -n openchoreo-control-plane
# All should reach Running within 3-5 minutes
```

Then open: **http://openchoreo.localhost:8080/**

| Field    | Value                  |
| -------- | ---------------------- |
| Username | `admin@openchoreo.dev` |
| Password | `Admin@123`            |

---

## Resource Requirements

|      | Minimum | Recommended                         |
| ---- | ------- | ----------------------------------- |
| RAM  | 4 GB    | 8 GB (if enabling CI/observability) |
| CPUs | 2       | 4                                   |

**Docker Desktop → Settings → Resources** — make sure Docker has at least 4 GB allocated before creating the cluster.

---

## Stopping / Restarting the cluster

```bash
k3d cluster stop openchoreo   # pause (keeps state)
k3d cluster start openchoreo  # resume
k3d cluster delete openchoreo # destroy everything
```
