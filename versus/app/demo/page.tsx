import { demoData } from "@/demo/sample";
import { buildDashboard } from "@/services/dashboard";
import { parseBenchmark, parseCurrency } from "@/services/load";
import { Dashboard } from "@/ui/Dashboard";
import { Shell } from "@/ui/Shell";

export const dynamic = "force-dynamic";

/** Demo mode: a deterministic sample portfolio through the same engine and the same page. */
export default async function Demo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const data = demoData();
  const model = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark: parseBenchmark(q.b), currency: parseCurrency(q.c) });
  return (
    <Shell right={<a className="btn btn-secondary" href="/auth/login">Connect your own</a>}>
      <Dashboard model={model} toggle={{ action: "/demo", method: "get" }} status={{ trackingState: "tracking", historySynced: true }}
        demo
        history={{ view: q.history ?? "recent", hrefFor: (v) => `/demo?${new URLSearchParams({ b: model.benchmark, c: model.currency, ...(v === "recent" ? {} : { history: v }) })}#history-h` }}
      />
    </Shell>
  );
}
