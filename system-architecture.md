# System Architecture

## Diagram

```
                                        ┌─────────────────────────────────────────────────────┐
                                        │                      SERVER                         │
                                        │                                                     │
                                        │          ┌──────────────────────────────────────┐   │
                                        │          │         KUBERNETES CLUSTER           │   │
  ┌──────┐  🔒TLS1  ┌─────┐  🔒TLS2  ┌──┐  ┌───┐  ┌───┐  ┌─────────┐  ┌───┐ ┌───┐ ┌───┐│   │
  │      │◄────────►│     │◄────────►│  │  │   │  │   │  │ Service │  │Svc│ │Svc│ │Svc││   │
  │ User │          │ CDN │          │LB│─►│API│─►│ A │─►│─────────│  │🐳 │ │🐳 │ │🐳 ││   │
  │      │          │     │          │  │  │   │  │ G │  │  docker │  └───┘ └───┘ └───┘│   │
  └──────┘          └─────┘          └──┘  └───┘  │ W │  └─────────┘                  │   │
                                        │          │   │  ┌─────────┐                  │   │
                                        │          └───┘  │  MySQL  │                  │   │
                                        │                 │  docker │                  │   │
                                        │                 └─────────┘                  │   │
                                        │          └──────────────────────────────────────┘   │
                                        └─────────────────────────────────────────────────────┘
```

## Request Flow (left → right)

```
User <--TLS1--> CDN <--TLS2--> Load Balancer --> API --> API Gateway --> Kubernetes Cluster
```

---

## On TLS: Why Two Locks?

The lecturer drew **one** TLS line first (User → Server), then slotted the CDN in between.
That split is intentional and correct:

| Hop | From | To | What happens |
|-----|------|----|--------------|
| TLS 1 | User | CDN | CDN **terminates** this TLS — decrypts, inspects, caches |
| TLS 2 | CDN | Origin server | CDN opens a **new** TLS connection to the origin |

> The CDN is not a transparent tunnel. It is a middlebox that ends one encrypted session
> and starts another. Two locks = two separate TLS handshakes.

---

## Layers

### 1. User (Client)
- Initiates the request
- TLS 1 starts here

### 2. CDN (Edge Cache)
- Terminates TLS 1 from the client
- Serves cached static content → reduces origin load
- Cache miss: forwards request over TLS 2 to the origin
- Acts as first line of DDoS absorption

### 3. Load Balancer
- Sits between CDN and the API entry point (outside the server block)
- Distributes incoming traffic across API instances
- Performs health checks; routes away from unhealthy nodes
- Can also handle TLS offloading (decrypts so backend sees plain HTTP)

### 4. API (Entry Point)
- Public-facing entry into the server
- Receives traffic from the load balancer

### 5. API Gateway
- Sits behind the API layer
- Handles: routing, authentication, rate-limiting, request transformation
- Dispatches to the correct microservice inside the Kubernetes cluster

### 6. Kubernetes Cluster
Orchestrates all containerised workloads:

| Workload   | Runtime | Role                      |
|------------|---------|---------------------------|
| Service ×3 | Docker  | Independent microservices |
| MySQL      | Docker  | Persistent relational DB  |

Kubernetes handles: scheduling, scaling, self-healing, service discovery.

---

## Response Path

```
Service → API Gateway → API → Load Balancer → CDN (caches if applicable) → TLS → User
```
