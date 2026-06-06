// In Kubernetes, NEXT_PUBLIC_API_URL points to the Choreo/API Gateway base URL.
// Locally it falls back to direct service ports.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const SERVICES = [
  { name: "service-hello",    url: API_BASE ? `${API_BASE}/hello/hello`    : "http://localhost:3001/hello" },
  { name: "service-users",    url: API_BASE ? `${API_BASE}/users/hello`    : "http://localhost:3002/hello" },
  { name: "service-products", url: API_BASE ? `${API_BASE}/products/hello` : "http://localhost:3003/hello" },
  { name: "service-orders",   url: API_BASE ? `${API_BASE}/orders/hello`   : "http://localhost:3004/hello" },
];

async function fetchService(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch {
    return { error: "Service unreachable" };
  }
}

export default async function Home() {
  const results = await Promise.all(
    SERVICES.map(async (svc) => ({
      ...svc,
      data: await fetchService(svc.url),
    }))
  );

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-8 py-16 px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Cloud Challenge
        </h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {results.map((svc) => {
            const isError = !!svc.data.error;
            return (
              <div
                key={svc.name}
                className={[
                  "rounded-xl border p-5 flex flex-col gap-3",
                  isError
                    ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "inline-block h-2 w-2 rounded-full",
                      isError ? "bg-red-400" : "bg-green-400",
                    ].join(" ")}
                  />
                  <span className="font-medium text-sm text-black dark:text-zinc-50">
                    {svc.name}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono">{svc.url}</p>
                <pre className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all">
                  {JSON.stringify(svc.data, null, 2)}
                </pre>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
