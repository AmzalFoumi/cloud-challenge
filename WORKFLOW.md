# Cloud Challenge: AWS + Kubernetes Deployment Workflow

> **Goal**: Deploy the microservices architecture to AWS, matching this flow:
> `User ↔ TLS ↔ CloudFront (CDN) → ALB (Load Balancer) → OpenChoreo (API Gateway) → EKS → Microservices + MySQL`
>
> **Frontend**: Deployed separately on **Vercel** — not inside EKS.
> **API Gateway**: OpenChoreo — run locally on k3d first, then move to EKS when ready.

---

## Quick Reference

| What | Value |
|------|-------|
| AWS region | `us-east-1` |
| EKS cluster name | `cloud-challenge` |
| Kubernetes namespace | `cloud-challenge` |
| Frontend | Vercel (free tier) |
| Cost while running (EKS only) | ~$0.12/hr (~$2.93/day) with t3.small |
| Cost with OpenChoreo on EKS | ~$0.30/hr (~$7.20/day) — needs t3.medium nodes |
| **Stop cost (run when done)** | `eksctl delete cluster --name cloud-challenge --region us-east-1` |

---

## Phase 0 — Prerequisites (one-time setup, ~30 min)

> **Why this phase?** You need four tools beyond Docker: AWS CLI authenticates every AWS API call, eksctl creates EKS clusters, kubectl talks to any Kubernetes cluster, and Helm installs packaged apps into Kubernetes.

### 0.1 Check what's already installed

```powershell
docker --version          # Should already be present
kubectl version --client  # Docker Desktop may have installed this
aws --version
eksctl version
helm version
```

### 0.2 Install missing tools

**AWS CLI v2**
```powershell
winget install Amazon.AWSCLI
# Verify:
aws --version
```

**eksctl** (EKS cluster manager — like "Minikube for AWS Kubernetes")
```powershell
# Download and extract
Invoke-WebRequest -Uri "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_Windows_amd64.zip" -OutFile eksctl.zip
Expand-Archive eksctl.zip -DestinationPath "$env:USERPROFILE\eksctl"
# Add to PATH: System Properties → Environment Variables → Path → New → paste the folder path
# Verify (in a new terminal):
eksctl version
```

**kubectl** (if not already present)
```powershell
winget install Kubernetes.kubectl
kubectl version --client
```

**Helm** (Kubernetes package manager)
```powershell
winget install Helm.Helm
helm version
```

### 0.3 Configure AWS CLI

```powershell
aws configure
```

It will prompt for four values:
```
AWS Access Key ID:     <from AWS Console → IAM → Users → your user → Security credentials>
AWS Secret Access Key: <same page, create one if you haven't>
Default region name:   us-east-1
Default output format: json
```

Verify it works:
```powershell
aws sts get-caller-identity
# Should print your account ID, user ARN, and user ID
```

Save your account ID — you'll need it throughout:
```powershell
$ACCOUNT_ID = $(aws sts get-caller-identity --query Account --output text)
$REGION = "us-east-1"
Write-Host "Account: $ACCOUNT_ID | Region: $REGION"
```

---

## Phase 1 — Dockerize the Microservices (~45 min)

> **Why this phase?** Kubernetes runs containers, not Node.js processes. Dockerfiles for all 4 Express services are already written at `services/*/Dockerfile`. The frontend runs on Vercel — no Dockerfile needed for it.

### 1.1 Test one service locally

```powershell
# From the repo root, build and run service-hello
docker build -t service-hello:test ./services/service-hello
docker run -d -p 3001:3001 --name test-hello service-hello:test

# Test it
Invoke-WebRequest http://localhost:3001/health | Select-Object -ExpandProperty Content
# Expected: {"status":"ok","service":"service-hello"}

# Clean up
docker stop test-hello && docker rm test-hello
```

**What to look for**: Container starts without errors. The `/health` endpoint returns JSON.

---

## Phase 2 — Push Images to Amazon ECR (~20 min)

> **Why ECR?** EKS nodes need to pull your images from somewhere. Amazon ECR (Elastic Container Registry) is like "S3 for Docker images." It's private, inside AWS, and free to transfer between ECR and EKS in the same region.

### 2.1 Create ECR repositories

```powershell
$ACCOUNT_ID = $(aws sts get-caller-identity --query Account --output text)
$REGION = "us-east-1"

$services = @("service-hello", "service-users", "service-products", "service-orders")
foreach ($svc in $services) {
    aws ecr create-repository `
        --repository-name "cloud-challenge/$svc" `
        --region $REGION `
        --image-scanning-configuration scanOnPush=true
    Write-Host "Created: cloud-challenge/$svc"
}
```

### 2.2 Authenticate Docker to ECR

> ECR requires a temporary 12-hour login token. Run this at the start of every session.

```powershell
aws ecr get-login-password --region $REGION | `
    docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
# Expected: Login Succeeded
```

### 2.3 Build and push all images

```powershell
$ECR_BASE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/cloud-challenge"

# Build each service
docker build -t "${ECR_BASE}/service-hello:latest"    ./services/service-hello
docker build -t "${ECR_BASE}/service-users:latest"    ./services/service-users
docker build -t "${ECR_BASE}/service-products:latest" ./services/service-products
docker build -t "${ECR_BASE}/service-orders:latest"   ./services/service-orders

# Push all images to ECR
docker push "${ECR_BASE}/service-hello:latest"
docker push "${ECR_BASE}/service-users:latest"
docker push "${ECR_BASE}/service-products:latest"
docker push "${ECR_BASE}/service-orders:latest"
```

### 2.4 Update image names in Kubernetes manifests

Replace the placeholder `<ACCOUNT_ID>` and `<REGION>` in each deployment YAML before continuing:

```powershell
# Run from repo root — replaces placeholders in all deployment files
$files = Get-ChildItem infra/k8s/*-deployment.yaml
foreach ($f in $files) {
    (Get-Content $f.FullName) `
        -replace '<ACCOUNT_ID>', $ACCOUNT_ID `
        -replace '<REGION>', $REGION |
    Set-Content $f.FullName
    Write-Host "Updated: $($f.Name)"
}
```

---

## Phase 3 — Create the EKS Cluster (~25 min, mostly waiting)

> **Why EKS?** EKS is "managed Kubernetes" — AWS runs the control plane (the brain of Kubernetes) for you. You only manage the worker nodes (the VMs your containers run on). `eksctl` is a CLI that automates the ~15 manual steps that EKS creation normally requires (VPC, subnets, IAM roles, node group, etc.).
>
> **Cost warning**: The EKS control plane costs **$0.10/hr** from this moment until you delete the cluster. Run the cleanup command in Phase 9 when you're done.

### 3.1 Create the cluster

```powershell
# Uses infra/eks/cluster.yaml — 2x t3.small spot nodes across 2 availability zones
eksctl create cluster -f infra/eks/cluster.yaml
```

This takes 15–20 minutes. While waiting, you can read ahead to understand Phase 4.

eksctl is creating:
- A VPC with public and private subnets
- IAM roles for the control plane and nodes
- The EKS control plane (managed by AWS)
- An EC2 Auto Scaling Group with 2 t3.small spot instances
- Your `~/.kube/config` is updated automatically

### 3.2 Verify the cluster

```powershell
kubectl get nodes
# Expected: 2 nodes in "Ready" status

kubectl cluster-info
# Shows the EKS API server endpoint
```

**Key concept — spot instances**: You're using spot instances (pre-emptible VMs). AWS can terminate them with 2 minutes notice, but they're ~70% cheaper than on-demand. Fine for a learning project; not for production.

---

## Phase 4 — Deploy Kubernetes Manifests (~15 min)

> **Why manifests?** YAML manifests declare "what you want" — Kubernetes continuously reconciles the actual state of the cluster to match. You say "I want 2 copies of service-hello running" and Kubernetes makes it happen and keeps it that way, restarting pods if they crash.

### 4.1 Apply all manifests in order

```powershell
# Namespace must exist before anything else
kubectl apply -f infra/k8s/namespace.yaml

# Database secret must exist before MySQL StatefulSet reads it
kubectl apply -f infra/k8s/mysql-secret.yaml
kubectl apply -f infra/k8s/mysql-statefulset.yaml

# Microservices
kubectl apply -f infra/k8s/service-hello-deployment.yaml
kubectl apply -f infra/k8s/service-users-deployment.yaml
kubectl apply -f infra/k8s/service-products-deployment.yaml
kubectl apply -f infra/k8s/service-orders-deployment.yaml
```

### 4.2 Watch pods come up

```powershell
kubectl get pods -n cloud-challenge -w
# Press Ctrl+C when all pods show Running
```

Expected output (takes ~1–2 minutes):
```
NAME                              READY   STATUS    RESTARTS
mysql-0                           1/1     Running   0
service-hello-xxx                 1/1     Running   0
service-orders-xxx                1/1     Running   0
service-products-xxx              1/1     Running   0
service-users-xxx                 1/1     Running   0
```

### 4.3 Understand what was created

```powershell
# See all services (ClusterIP = internal only, not internet-accessible yet)
kubectl get services -n cloud-challenge

# Check logs for a specific service
kubectl logs -n cloud-challenge deployment/service-hello

# Describe a pod for detailed events
kubectl describe pod -n cloud-challenge -l app=service-hello
```

**Key concepts**:
- **Deployment**: Manages a set of identical pods. Ensures 2 replicas are always running.
- **Pod**: One running instance of a container. Kubernetes schedules pods onto nodes.
- **ClusterIP Service**: A stable internal IP/DNS name for a set of pods. `service-hello` resolves to `service-hello.cloud-challenge.svc.cluster.local` inside the cluster.
- **StatefulSet**: Like a Deployment but for stateful apps (like MySQL). Pods get stable names (`mysql-0`) and persistent volumes.

---

## Phase 5 — AWS Load Balancer Controller + ALB Ingress (~20 min)

> **Why this phase?** The Ingress resource is a Kubernetes "routing table" — it says "path /hello goes to service-hello." But Kubernetes doesn't know how to create an AWS ALB by itself. The AWS Load Balancer Controller is a Kubernetes controller that watches for Ingress resources and creates real AWS ALBs automatically.
>
> IRSA (IAM Roles for Service Accounts) is used here — the controller pod assumes an AWS IAM role to call the AWS API. This is safer than giving all nodes blanket AWS permissions.

### 5.1 Create the IAM policy

```powershell
# Download the permissions policy that ALB controller needs
Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.2/docs/install/iam_policy.json" `
    -OutFile iam_policy.json

# Create the policy in your AWS account
aws iam create-policy `
    --policy-name AWSLoadBalancerControllerIAMPolicy `
    --policy-document file://iam_policy.json
```

### 5.2 Create the IRSA service account

```powershell
eksctl create iamserviceaccount `
    --cluster=cloud-challenge `
    --namespace=kube-system `
    --name=aws-load-balancer-controller `
    --attach-policy-arn="arn:aws:iam::${ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy" `
    --override-existing-serviceaccounts `
    --approve
```

### 5.3 Install the controller via Helm

```powershell
helm repo add eks https://aws.github.io/eks-charts
helm repo update

$VPC_ID = $(aws eks describe-cluster `
    --name cloud-challenge `
    --region us-east-1 `
    --query "cluster.resourcesVpcConfig.vpcId" `
    --output text)

helm install aws-load-balancer-controller eks/aws-load-balancer-controller `
    -n kube-system `
    --set clusterName=cloud-challenge `
    --set serviceAccount.create=false `
    --set serviceAccount.name=aws-load-balancer-controller `
    --set region=us-east-1 `
    --set vpcId=$VPC_ID

# Verify the controller is running
kubectl get deployment -n kube-system aws-load-balancer-controller
```

### 5.4 Apply the ALB Ingress

```powershell
kubectl apply -f infra/k8s/ingress-alb.yaml

# Wait ~2 minutes for the ALB to provision, then get its URL
kubectl get ingress -n cloud-challenge
# ADDRESS column shows something like: k8s-xxx.us-east-1.elb.amazonaws.com
```

Save the ALB DNS name — you'll need it for CloudFront and Choreo:
```powershell
$ALB_DNS = $(kubectl get ingress -n cloud-challenge cloud-challenge-ingress `
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
Write-Host "ALB: $ALB_DNS"
```

### 5.5 Test the ALB directly

```powershell
# Test microservices through ALB (HTTP, no TLS yet)
Invoke-WebRequest "http://$ALB_DNS/hello/health" | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://$ALB_DNS/users/health"    | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://$ALB_DNS/products/health" | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://$ALB_DNS/orders/health"   | Select-Object -ExpandProperty Content
```

All four should return `{"status":"ok","service":"service-xxx"}`.

---

## Phase 6 — Deploy Frontend to Vercel (~15 min)

> **Why Vercel?** Vercel is the platform built by the Next.js team — it deploys Next.js apps natively with zero config, free tier, automatic HTTPS, and global CDN. Running the frontend inside EKS would waste node resources on something Vercel does better for free.
>
> The frontend is fully decoupled from EKS. It calls the backend via `NEXT_PUBLIC_API_URL`, which you'll set to the Choreo gateway URL after Phase 7.

### 6.1 Push the repo to GitHub (if not already)

Vercel connects to your GitHub repo to auto-deploy on every push.

```powershell
# From repo root
git init
git add .
git commit -m "initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/your-username/cloud-challenge.git
git push -u origin main
```

### 6.2 Create a Vercel project

1. Go to **vercel.com** → **Add New Project**
2. Import your GitHub repository
3. Under **Root Directory**, click **Edit** and set it to `apps/frontend`
4. Leave all other settings at defaults (Vercel auto-detects Next.js)
5. Click **Deploy**

Vercel builds and deploys in ~1 minute. You'll get a URL like `cloud-challenge.vercel.app`.

### 6.3 Add the API URL environment variable (do this after Phase 7)

Once you have your Choreo gateway URL (from Phase 7):

1. In Vercel → your project → **Settings** → **Environment Variables**
2. Add:
   - **Name**: `NEXT_PUBLIC_API_URL`
   - **Value**: `https://your-org.choreo.dev/cloud-challenge/v1` (your Choreo gateway URL)
   - **Environment**: Production (and Preview if you want)
3. Go to **Deployments** → click the three dots on the latest deployment → **Redeploy**

After redeployment, the frontend fetches services through Choreo → ALB → EKS pods.

### 6.4 Test the frontend

```powershell
# Open in browser — services panel should show all 4 services as reachable
Start-Process "https://cloud-challenge.vercel.app"
```

---

## Phase 7 — OpenChoreo API Gateway

> **Why an API Gateway?** Each microservice shouldn't have to implement authentication, rate limiting, and routing independently. The API Gateway is a single entry point that handles all of that.
>
> **OpenChoreo** is WSO2's open-source Internal Developer Platform — it includes a full API gateway (kgateway/Envoy), a developer portal (Backstage), observability, and CI/CD. It runs inside your Kubernetes cluster.
>
> **Strategy**: Learn OpenChoreo locally on k3d first. When comfortable, install the same Helm charts on EKS.

### 7.1 Local OpenChoreo (do this before EKS)

The local setup is documented separately — follow the **"Local OpenChoreo Setup"** explanation (shared alongside this workflow). It walks through:
- Installing k3d
- Creating the OpenChoreo k3d cluster
- Installing all dependencies (cert-manager, kgateway, thunder, etc.)
- Installing OpenChoreo control plane + data plane

Once local is working, you'll have hands-on familiarity before touching AWS.

### 7.2 OpenChoreo on EKS (when you're ready)

> **Node size change required**: OpenChoreo needs ~4 GB RAM per node. Before running this phase, update `infra/eks/cluster.yaml` to use `t3.medium` instead of `t3.small`.

```yaml
# infra/eks/cluster.yaml — change this line:
instanceType: t3.medium   # was t3.small
```

Recreate the cluster if it already exists:
```powershell
eksctl delete cluster --name cloud-challenge --region us-east-1
# Edit infra/eks/cluster.yaml, then:
eksctl create cluster -f infra/eks/cluster.yaml
```

Clone the OpenChoreo repo on your machine (contains the Helm charts):
```powershell
git clone https://github.com/openchoreo/openchoreo.git
cd openchoreo
```

Install in the same dependency order as local — the commands are identical, but they run against your EKS kubeconfig (which eksctl already configured):

```bash
# Gateway API CRDs
kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.1/experimental-install.yaml

# cert-manager
helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.19.2 --set crds.enabled=true

# external-secrets
helm upgrade --install external-secrets oci://ghcr.io/external-secrets/charts/external-secrets \
  --namespace external-secrets --create-namespace \
  --version 1.3.2 --set installCRDs=true

# kgateway
helm upgrade --install kgateway-crds oci://cr.kgateway.dev/kgateway-dev/charts/kgateway-crds \
  --create-namespace --namespace openchoreo-control-plane --version v2.2.1

helm upgrade --install kgateway oci://cr.kgateway.dev/kgateway-dev/charts/kgateway \
  --namespace openchoreo-control-plane --create-namespace --version v2.2.1 \
  --set controller.extraEnv.KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true

# thunder (auth layer)
helm upgrade --install thunder oci://ghcr.io/asgardeo/helm-charts/thunder \
  --namespace openchoreo-control-plane --create-namespace \
  --version 0.23.0 --values install/k3d/common/values-thunder.yaml

# backstage secrets
kubectl create secret generic backstage-secrets -n openchoreo-control-plane \
  --from-literal=backend-secret="<any-random-32-char-string>" \
  --from-literal=client-secret="backstage-portal-secret" \
  --from-literal=jenkins-api-key="placeholder-not-in-use"

# OpenChoreo control plane + data plane
# Note: use EKS-specific values files if available; otherwise start with k3d values
# and adjust — check https://github.com/openchoreo/openchoreo for EKS examples
helm upgrade --install openchoreo-control-plane install/helm/openchoreo-control-plane \
  --namespace openchoreo-control-plane --create-namespace \
  --values install/k3d/single-cluster/values-cp.yaml

helm upgrade --install openchoreo-data-plane install/helm/openchoreo-data-plane \
  --dependency-update \
  --namespace openchoreo-data-plane --create-namespace \
  --values install/k3d/single-cluster/values-dp.yaml
```

### 7.3 Register your services with OpenChoreo

Once OpenChoreo is running, define each microservice as a Component. OpenChoreo will create the API routes, apply auth/rate-limiting, and expose a managed gateway URL.

```bash
# Verify all OpenChoreo pods are running first
kubectl get pods -n openchoreo-control-plane
kubectl get pods -n openchoreo-data-plane
```

Access the developer portal (on EKS, use `kubectl port-forward`):
```bash
kubectl port-forward svc/openchoreo-control-plane -n openchoreo-control-plane 8080:8080
# Open http://localhost:8080 — login: admin@openchoreo.dev / Admin@123
```

### 7.4 Get the OpenChoreo Gateway URL

After registering services, OpenChoreo exposes a gateway endpoint. Copy it — you'll need it for Vercel (`NEXT_PUBLIC_API_URL`) and CloudFront origin.

**Go back to Phase 6.3** and set `NEXT_PUBLIC_API_URL` to your OpenChoreo gateway URL in Vercel.

---

## Phase 8 — CloudFront CDN + TLS (~15 min)

> **Why CloudFront?** CloudFront is AWS's CDN. It caches content at ~450 edge locations worldwide so users get responses from a server close to them. It also provides free HTTPS via a `*.cloudfront.net` certificate — this gives you TLS Hop 1 without managing any certs yourself.
>
> **Understanding the two TLS hops**:
>
> | Hop | From → To | What happens |
> |-----|-----------|--------------|
> | **TLS 1** | User → CloudFront | CloudFront **terminates** TLS — decrypts the request, inspects headers, checks cache. Uses a `*.cloudfront.net` cert managed by AWS. |
> | **TLS 2** | CloudFront → ALB | CloudFront opens a **new** connection to the origin. For this project we use HTTP (not HTTPS) because your ALB uses an auto-generated ELB hostname that you can't get an ACM cert for without a custom domain. Traffic stays inside AWS's private network. |
>
> The CDN is not a transparent pipe — it ends one encrypted session and starts another. That's why the architecture diagram shows **two locks**.

### 8.1 Create a CloudFront distribution (AWS Console)

1. Go to **AWS Console → CloudFront → Create distribution**
2. **Origin domain**: paste your ALB DNS (from Phase 5, `$ALB_DNS`)
3. **Protocol**: HTTP only (origin is HTTP)
4. **HTTP port**: 80
5. **Viewer protocol policy**: Redirect HTTP to HTTPS — this activates TLS Hop 1
6. **Allowed HTTP methods**: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE (APIs need POST)
7. **Cache policy**: select **CachingDisabled** (your APIs return dynamic data)
8. **Origin request policy**: **AllViewer** (forwards headers/query strings to origin)
9. **Price class**: **Use only North America and Europe** (cheapest)
10. **Comment**: `cloud-challenge`
11. Click **Create distribution**

Wait ~10 minutes for the distribution to deploy (Status changes from "Deploying" to "Enabled").

### 8.2 Get your CloudFront URL

On the distribution detail page, copy the **Distribution domain name**: `xyz.cloudfront.net`

### 8.3 Test the API layer through CloudFront

```powershell
$CF = "https://xyz.cloudfront.net"  # paste your CloudFront domain

# Services through the full stack: User → HTTPS → CloudFront → HTTP → ALB → EKS
Invoke-WebRequest "$CF/hello/health"    | Select-Object -ExpandProperty Content
Invoke-WebRequest "$CF/users/health"    | Select-Object -ExpandProperty Content
Invoke-WebRequest "$CF/products/health" | Select-Object -ExpandProperty Content
Invoke-WebRequest "$CF/orders/health"   | Select-Object -ExpandProperty Content

# Check CloudFront cache headers
Invoke-WebRequest "$CF/hello/hello" -UseBasicParsing | Select-Object -ExpandProperty Headers
# Look for: x-cache: Miss from cloudfront (first request)
#           x-cache: Hit from cloudfront  (cached request)
```

---

## Phase 9 — End-to-End Architecture Verification

The full request flow is now:

```
Browser (HTTPS) → Vercel (frontend CDN)
                       │
                       │ NEXT_PUBLIC_API_URL (API calls only)
                       ▼
Browser → HTTPS → CloudFront Edge
                       │ HTTP (stays inside AWS network)
                       ▼
              ALB (xyz.us-east-1.elb.amazonaws.com)
                       │ path-based routing
                       ▼
              EKS Ingress → Kubernetes ClusterIP Services
                       │
                       ▼
  Pods: service-hello × 2, service-users × 2, service-products × 2, service-orders × 2
                       │
                       ▼
               MySQL StatefulSet (EBS volume)
```

### Verification checklist

```powershell
# 1. All pods running
kubectl get pods -n cloud-challenge

# 2. ALB has an address
kubectl get ingress -n cloud-challenge

# 3. Services reachable via CloudFront
Invoke-WebRequest "https://xyz.cloudfront.net/hello/hello" | Select-Object -ExpandProperty Content

# 4. CloudFront headers present (proves CDN is in the path)
(Invoke-WebRequest "https://xyz.cloudfront.net/hello/hello" -UseBasicParsing).Headers["x-cache"]

# 5. Frontend loads on Vercel and shows services as reachable
Start-Process "https://cloud-challenge.vercel.app"
```

---

## Phase 10 — Cleanup (run at the end of every session)

> **Important**: EKS costs $0.10/hr even with no traffic. Always delete the cluster when you're done for the day. Vercel and Choreo free tiers cost nothing — leave those running.

```powershell
# Step 1: Disable and delete the CloudFront distribution
# Console: CloudFront → select distribution → Disable → wait → Delete
# Or via CLI:
$DIST_ID = $(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='cloud-challenge'].Id" --output text)
# Disable first (distribution must be disabled before deletion) — use the Console for simplicity

# Step 2: Delete the EKS cluster (also deletes VPC, nodes, ALB, EBS volumes)
eksctl delete cluster --name cloud-challenge --region us-east-1
# Takes 10-15 minutes
# Note: The MySQL EBS data is deleted too — that's fine for learning

# Step 3: Verify nothing is still running
aws eks list-clusters --region us-east-1
aws elbv2 describe-load-balancers --region us-east-1 --query "LoadBalancers[].DNSName"

# Step 4 (optional): Delete ECR repos to avoid any storage cost
$services = @("service-hello", "service-users", "service-products", "service-orders")
foreach ($svc in $services) {
    aws ecr delete-repository --repository-name "cloud-challenge/$svc" --force --region us-east-1
}
```

### Restart for your next session

```powershell
# 1. Re-authenticate Docker to ECR (tokens expire every 12 hours)
$ACCOUNT_ID = $(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region us-east-1 | `
    docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"

# 2. Recreate the cluster (15-20 min)
eksctl create cluster -f infra/eks/cluster.yaml

# 3. Re-install ALB controller (Phase 5.3)

# 4. Re-apply all manifests
kubectl apply -f infra/k8s/

# 5. Re-create CloudFront distribution (Phase 8)

# 6. Vercel stays deployed — no action needed
```

---

## Appendix A — Cost Breakdown

| Component | Rate | Notes |
|-----------|------|-------|
| EKS control plane | $0.10/hr | Charged from create to delete |
| 2× t3.small (spot) | ~$0.009/hr total | Before OpenChoreo on EKS |
| 2× t3.medium (spot) | ~$0.034/hr total | Required when OpenChoreo runs on EKS |
| ALB | ~$0.008/hr + LCU | Minimal for learning traffic |
| EBS (MySQL 5GB gp2) | ~$0.50/month | Deleted when cluster is deleted |
| ECR storage | ~$0/month | 500MB free tier |
| CloudFront | ~$0/month | 1TB/month + 10M requests free |
| Vercel | $0 | Free tier |
| OpenChoreo (local k3d) | $0 | Runs on your machine |
| **Total — microservices only (t3.small)** | **~$0.12/hr** | **~$2.93/day** |
| **Total — with OpenChoreo on EKS (t3.medium)** | **~$0.31/hr** | **~$7.44/day** |

---

## Appendix B — OpenChoreo Component Model (Replacing Raw kubectl Manifests)

OpenChoreo can go further than just API gateway — it can manage your microservice deployments too, replacing the raw `kubectl apply` manifests in Phase 4. This is what "using OpenChoreo for the K8s stuff" means.

Instead of Deployment + Service YAMLs, you define a **Component** in OpenChoreo:

```yaml
apiVersion: core.choreo.dev/v1alpha1
kind: Component
metadata:
  name: service-hello
  namespace: default
spec:
  type: Service
  source:
    containerRegistry:
      image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/cloud-challenge/service-hello:latest
  endpoints:
    - name: http
      port: 3001
      type: REST
```

OpenChoreo then handles scheduling, routing, and exposing the service through the gateway — you don't write Deployment or Service YAMLs manually.

**When to switch**: After you're comfortable with OpenChoreo locally and have deployed at least one service through its UI. The raw manifests in `infra/k8s/` remain as a fallback if you want direct kubectl control.

---

## Appendix C — Troubleshooting

| Problem | Command | Fix |
|---------|---------|-----|
| Pod stuck in `Pending` | `kubectl describe pod <name> -n cloud-challenge` | Usually insufficient resources — check node capacity |
| Pod stuck in `ImagePullBackOff` | `kubectl describe pod <name> -n cloud-challenge` | ECR auth expired or wrong image URL |
| ALB not created | `kubectl describe ingress -n cloud-challenge` | ALB controller not installed or IAM policy missing |
| 504 from CloudFront | Check ALB target group health | Pod not passing health check |
| `exec /bin/sh: exec format error` | Check Docker build platform | Build for linux/amd64: `docker build --platform linux/amd64` |
| Vercel build fails | Check Vercel build logs | Ensure root directory is set to `apps/frontend` |
| Frontend shows services unreachable | Check `NEXT_PUBLIC_API_URL` in Vercel env vars | Must point to OpenChoreo gateway URL, then redeploy |

```powershell
# Useful debugging commands
kubectl get events -n cloud-challenge --sort-by='.lastTimestamp'
kubectl logs -n cloud-challenge deployment/service-hello --previous
kubectl exec -it -n cloud-challenge deployment/service-hello -- sh
```

---

## Appendix D — What Each Kubernetes Object Does

| Object | What it is | Analogy |
|--------|-----------|---------|
| **Namespace** | Logical partition inside a cluster | A folder |
| **Deployment** | Manages N identical running pods | A process manager |
| **Pod** | One or more containers running together | A single running container group |
| **ClusterIP Service** | Stable internal DNS name for a set of pods | Internal load balancer |
| **StatefulSet** | Like Deployment but pods get stable names and persistent volumes | For databases |
| **PersistentVolumeClaim** | Request for disk storage; EKS auto-provisions EBS | Asking for a hard drive |
| **Secret** | Encrypted key-value store for sensitive data | `.env` file but encrypted |
| **Ingress** | HTTP routing rules (path → service) | nginx config |
| **IngressClass** | Which controller handles an Ingress (e.g., ALB) | Which nginx instance |
