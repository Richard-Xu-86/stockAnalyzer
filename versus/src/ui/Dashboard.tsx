import type { DashboardModel } from "@/services/dashboard";
import { MIN_PATTERN_DAYS } from "@/domain/metrics";
import type { DayResult } from "@/domain/returns";
import { TrendChart } from "./TrendChart";
import { D, type Dec } from "@/domain/decimal";
import { day, isLoss, money, month, pct, pts, ratio, shortDay } from "./format";

export interface DashboardProps {
  model: DashboardModel;
  /** Where the S&P 500 / TSX and CAD / USD buttons submit: POST for a signed-in user, GET for the demo. */
  toggle: { action: string; method: "get" | "post" };
  status: {
    trackingState: string;
    historySynced: boolean;
  };
  demo?: boolean;
  /** Which months the history table shows, and how to link to another choice. */
  history: { view: HistoryView; hrefFor: (view: HistoryView) => string };
}

/** The whole dashboard. Server component: no client JavaScript, so it is fast and works everywhere. */
export function Dashboard({ model, toggle, status, demo, history }: DashboardProps) {
  const latest = model.latest;
  return (
    <>
      <Controls model={model} toggle={toggle} />
      <Banners model={model} status={status} demo={demo} />
      <div className={model.latest?.drivers && model.drivers.length > 0 ? "grid" : "grid single"}>
        <Today model={model} />
        <Drivers model={model} />
      </div>
      <div className="stack">
        <Trend model={model} />
        <Patterns model={model} />
        <Recent days={model.recentDays} benchmarkLabel={model.benchmarkLabel} />
        <History model={model} view={history.view} hrefFor={history.hrefFor} />
      </div>
      {latest && latest.valueEnd && (
        <p className="quiet xs" style={{ marginTop: "var(--space-6)" }}>
          Portfolio value at the {day(latest.date)} close: <span className="num">{money(latest.valueEnd, model.currency)}</span>, priced by your broker.
        </p>
      )}
    </>
  );
}

function Controls({ model, toggle }: Pick<DashboardProps, "model" | "toggle">) {
  return (
    <div className="controls" aria-label="View options">
      <form action={toggle.action} method={toggle.method}>
        <fieldset className="toggle">
          <legend>Compare to</legend>
          <input type="hidden" name="c" value={model.currency} />
          <span className="group">
            <button name="b" value="sp500" aria-pressed={model.benchmark === "sp500"}>S&amp;P 500</button>
            <button name="b" value="tsx" aria-pressed={model.benchmark === "tsx"}>TSX</button>
          </span>
        </fieldset>
      </form>
      <form action={toggle.action} method={toggle.method}>
        <fieldset className="toggle">
          <legend>Show in</legend>
          <input type="hidden" name="b" value={model.benchmark} />
          <span className="group">
            <button name="c" value="CAD" aria-pressed={model.currency === "CAD"}>CAD</button>
            <button name="c" value="USD" aria-pressed={model.currency === "USD"}>USD</button>
          </span>
        </fieldset>
      </form>
    </div>
  );
}

function Banners({ model, status, demo }: Pick<DashboardProps, "model" | "status" | "demo">) {
  const out: React.ReactNode[] = [];
  if (demo) {
    out.push(
      <div className="banner info" key="demo" role="note">
        <p>
          <strong>Sample portfolio.</strong> Invented holdings run through the real maths: a deposit, a stock split, a transfer between accounts, a missed day and a Canadian holiday are all in here.
        </p>
      </div>,
    );
  }
  if (status.trackingState === "needs_signin") {
    out.push(
      <div className="banner" key="signin" role="alert">
        <p>
          <strong>Sign in again to keep tracking.</strong> SnapTrade ended our access, so no snapshot was taken after the last close. Days missed until you sign in can&apos;t be filled in later.
        </p>
        <p style={{ marginTop: "var(--space-2)" }}>
          <a className="btn btn-primary" href="/auth/login">Sign in with SnapTrade</a>
        </p>
      </div>,
    );
  }
  if (status.trackingState === "broken") {
    out.push(
      <div className="banner" key="broken" role="status">
        <p>
          <strong>The last snapshot didn&apos;t complete.</strong> Your broker&apos;s data couldn&apos;t be read. We try again after the next close.
        </p>
      </div>,
    );
  }
  if (!status.historySynced) {
    out.push(
      <div className="banner info" key="sync" role="status">
        <p>
          <strong>Importing your account history.</strong> This takes a minute or two. Refresh the page to see it.
        </p>
      </div>,
    );
  }
  if (model.okSnapshots === 0) {
    out.push(
      <div className="banner info" key="first" role="status">
        <p>
          <strong>Your first snapshot is taken after today&apos;s close.</strong> Versus records your portfolio each weekday after 4 PM Eastern. Your first comparison with the market appears after the close the next trading day.
        </p>
      </div>,
    );
  } else if (model.okSnapshots === 1 && !model.latest) {
    out.push(
      <div className="banner info" key="one" role="status">
        <p>
          <strong>One snapshot so far ({day(model.trackingSince!)}).</strong> A comparison needs two closes, so your first one appears after the next trading day&apos;s close.
        </p>
      </div>,
    );
  }
  return <>{out}</>;
}

function verdict(r: DayResult) {
  const diff = r.r!.minus(r.b!);
  const behind = isLoss(diff);
  if (diff.toDecimalPlaces(4).isZero()) return { text: "In line with the market", mark: "=", behind: false, diff };
  return { text: behind ? "Behind the market" : "Ahead of the market", mark: behind ? "✗" : "✓", behind, diff };
}

function Today({ model }: { model: DashboardModel }) {
  const d = model.latest;
  return (
    <section className="sheet" aria-labelledby="today-h">
      <h2 id="today-h">{d ? (d.spans > 1 ? `Since ${shortDay(d.prevDate)}` : day(d.date, true)) : "Today"}</h2>
      <p className="sub quiet small">
        {d
          ? d.spans > 1
            ? `${d.spans} trading days to ${day(d.date)}: ${d.combinedOver ? `no market price was recorded for ${d.combinedOver.map(shortDay).join(", ")}` : "a run was missed"}, so these are combined.`
            : "Close to close, deposits and withdrawals removed."
          : "Waiting for two closes to compare."}
      </p>
      {d && d.status === "excluded" && (
        <p>
          <strong>Not counted.</strong> {d.reason}
        </p>
      )}
      {d && d.r && !d.b && d.status !== "excluded" && (
        <>
          <table className="statement">
            <tbody>
              <tr>
                <th scope="row">You</th>
                <td className={`num ${isLoss(d.r) ? "loss" : ""}`}>{pct(d.r)}</td>
              </tr>
              <tr>
                <th scope="row">{model.benchmarkLabel}</th>
                <td className="num quiet">–</td>
              </tr>
            </tbody>
          </table>
          <p className="quiet small" style={{ marginTop: "var(--space-3)" }}>
            The {model.benchmarkLabel}&apos;s closing price for {shortDay(d.prevDate)} wasn&apos;t recorded, so this day can&apos;t be compared with the market. Your return still counts toward your own history; comparisons pick up from the next close.
          </p>
        </>
      )}
      {d && d.r && d.b && (
        <>
          <table className="statement">
            <tbody>
              <tr>
                <th scope="row">You</th>
                <td className={`num ${isLoss(d.r) ? "loss" : ""}`}>{pct(d.r)}</td>
              </tr>
              <tr>
                <th scope="row">
                  {model.benchmarkLabel}
                  {d.benchmarkMarketClosed && <span className="quiet small"> (market closed)</span>}
                </th>
                <td className="num">{pct(d.b)}</td>
              </tr>
              <tr className="total">
                <th scope="row">Difference</th>
                <td>
                  <span className={`total-figure num ${verdict(d).behind ? "loss" : ""}`}>{pts(verdict(d).diff)}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className={`verdict ${verdict(d).behind ? "loss" : ""}`}>
            <span className={`mark ${verdict(d).behind ? "loss" : ""}`} aria-hidden="true">{verdict(d).mark}</span>
            <span>{verdict(d).text}</span>
          </p>
          {d.status === "provisional" && (
            <p className="quiet small" style={{ marginTop: "var(--space-3)" }}>
              Provisional: your broker hasn&apos;t finished reporting today&apos;s transactions. If a deposit or withdrawal shows up, this day is recalculated.
            </p>
          )}
          {d.coverage && d.coverage.lt(1) && (
            <p className="quiet small" style={{ marginTop: "var(--space-2)" }}>
              Based on {pct(d.coverage, 0).replace("+", "")} of your portfolio. Your broker didn&apos;t price the rest today.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Drivers({ model }: { model: DashboardModel }) {
  if (!model.latest?.drivers || model.drivers.length === 0) return null;
  return (
    <section className="sheet" aria-labelledby="drivers-h">
      <h2 id="drivers-h">What moved you</h2>
      <p className="sub quiet small">Each line&apos;s share of your return, in percentage points.</p>
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col" className="r">Effect</th>
          </tr>
        </thead>
        <tbody>
          {model.drivers.map((l) => (
            <tr key={l.label}>
              <td>{l.label}</td>
              <td className={`r num ${isLoss(l.effect) ? "loss" : ""}`}>{pts(l.effect)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="quiet xs" style={{ marginTop: "var(--space-3)" }}>
        &ldquo;Currency moves&rdquo; is the effect of the US dollar against the Canadian dollar on holdings in the other currency. &ldquo;Trades and cash&rdquo; covers buying, selling, dividends and interest during the day.
      </p>
    </section>
  );
}

function Trend({ model }: { model: DashboardModel }) {
  const m = model.metrics;
  if (m.trend.length === 0) return null;
  const behind = m.cumulativeYou && m.cumulativeMarket ? isLoss(m.cumulativeYou.minus(m.cumulativeMarket)) : false;
  return (
    <section className="sheet" aria-labelledby="trend-h">
      <h2 id="trend-h">Since you started tracking</h2>
      <p className="sub quiet small">
        {m.comparableDays} comparable trading {m.comparableDays === 1 ? "day" : "days"} since {day(model.trackingSince!)}
        {m.excludedDays > 0 ? `; ${m.excludedDays} left out (see recent days)` : ""}. Both lines use the same days.
      </p>
      <p>
        You <span className={`num ${isLoss(m.cumulativeYou) ? "loss" : ""}`}>{pct(m.cumulativeYou)}</span>, {model.benchmarkLabel} <span className="num">{pct(m.cumulativeMarket)}</span>
        {m.cumulativeYou && m.cumulativeMarket && (
          <>
            {" "}
            (<span className={`num ${behind ? "loss" : ""}`}>{pts(m.cumulativeYou.minus(m.cumulativeMarket))}</span>)
          </>
        )}
      </p>
      <TrendChart points={m.trend} benchmarkLabel={model.benchmarkLabel} />
      <details>
        <summary>Show the numbers</summary>
        <div className="scroll">
          <table className="ledger">
            <caption>Cumulative return at each close</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="r">You</th>
                <th scope="col" className="r">{model.benchmarkLabel}</th>
              </tr>
            </thead>
            <tbody>
              {m.trend.map((p) => (
                <tr key={p.date}>
                  <td>{shortDay(p.date)}</td>
                  <td className="r num">{pct(p.you)}</td>
                  <td className="r num">{pct(p.market)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Patterns({ model }: { model: DashboardModel }) {
  const m = model.metrics;
  if (m.trend.length === 0) return null;
  const label = model.benchmarkLabel;
  return (
    <section className="sheet" aria-labelledby="patterns-h">
      <h2 id="patterns-h">How you move with the market</h2>
      {!m.enoughForPatterns ? (
        <p className="quiet small" style={{ marginTop: "var(--space-2)" }}>
          Patterns appear after {MIN_PATTERN_DAYS} comparable days. You have {m.comparableDays}.
        </p>
      ) : (
        <>
          <p className="sub quiet small">
            Over your last {m.window} comparable days.{m.earlyEstimate ? " Early estimate: these settle down after about three months of tracking." : ""}
          </p>
          <dl className="metrics">
            <div>
              <dt>On up days</dt>
              <dd className="num">{ratio(m.upCapture)}×</dd>
              <dd>You capture this much of the {label}&apos;s average gain.</dd>
            </div>
            <div>
              <dt>On down days</dt>
              <dd className="num">{ratio(m.downCapture)}×</dd>
              <dd>You take this much of its average loss. Lower is better.</dd>
            </div>
            <div>
              <dt>Sensitivity (beta)</dt>
              <dd className="num">{ratio(m.beta)}</dd>
              <dd>When the {label} moves 1%, you tend to move this many percent.</dd>
            </div>
            <div>
              <dt>Days you beat it</dt>
              <dd className="num">{m.hitRate ? pct(m.hitRate, 0).replace("+", "") : "–"}</dd>
              <dd>Share of days your return was higher.</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function Recent({ days, benchmarkLabel }: { days: DayResult[]; benchmarkLabel: string }) {
  if (days.length === 0) return null;
  return (
    <section className="sheet" aria-labelledby="recent-h">
      <h2 id="recent-h">Recent days</h2>
      <div className="scroll" style={{ marginTop: "var(--space-3)" }}>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Close</th>
              <th scope="col" className="r">You</th>
              <th scope="col" className="r">{benchmarkLabel}</th>
              <th scope="col" className="r">Difference</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const diff = d.r && d.b ? d.r.minus(d.b) : null;
              return (
                <tr key={d.date} className={d.status === "excluded" ? "excluded" : undefined}>
                  <td>{shortDay(d.date)}</td>
                  <td className={`r num ${isLoss(d.r) ? "loss" : ""}`}>{d.status === "excluded" ? "–" : pct(d.r)}</td>
                  <td className="r num">{d.status === "excluded" ? "–" : pct(d.b)}</td>
                  <td className={`r num ${isLoss(diff) ? "loss" : ""}`}>{d.status === "excluded" ? "–" : pts(diff)}</td>
                  <td className="small">{note(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function note(d: DayResult): string {
  if (d.status === "excluded") return `Not counted: ${d.reason ?? "incomplete data"}`;
  const parts: string[] = [];
  if (d.spans > 1) parts.push(`Covers ${d.spans} trading days (${d.combinedOver ? `no market price for ${d.combinedOver.map(shortDay).join(", ")}` : "missed run"})`);
  if (d.status === "provisional") parts.push("Provisional");
  if (d.benchmarkMarketClosed) parts.push("Market holiday");
  if (d.r && !d.b) parts.push("No market price recorded for the previous close");
  return parts.join(". ");
}

/** "recent" (last 12 months), a year like "2025", or "all". */
export type HistoryView = string;

function History({ model, view, hrefFor }: { model: DashboardModel; view: HistoryView; hrefFor: (view: HistoryView) => string }) {
  const h = model.dayOne;
  if (h.months.length === 0) return null;
  const years = [...new Set(h.months.map((m) => m.month.slice(0, 4)))].sort().reverse();
  const current = view === "all" || years.includes(view) ? view : "recent";
  const newestFirst = [...h.months].reverse();
  const shown = current === "all" ? newestFirst : current === "recent" ? newestFirst.slice(0, 12) : newestFirst.filter((m) => m.month.startsWith(current));
  const ccys = [...new Set(h.months.flatMap((m) => Object.keys(m.deposits)))].sort();
  const options: Array<[HistoryView, string]> = [["recent", "Last 12 months"], ...years.map((y): [string, string] => [y, y]), ["all", "All"]];
  const total = (c: string) => shown.reduce((t, m) => (m.deposits[c] ? t.plus(m.deposits[c]!) : t), new D(0));
  const amount = (x: Dec | undefined, c: string) => (x && !x.isZero() ? money(x, c as "CAD" | "USD").replace(` ${c}`, "") : "–");
  const rangeLabel = current === "all" ? "" : current === "recent" ? " in the last 12 months" : ` in ${current}`;

  return (
    <section className="sheet" aria-labelledby="history-h">
      <h2 id="history-h">Before you started tracking</h2>
      <p className="sub quiet small">
        From your account history since {day(h.firstDate!)}. Your broker doesn&apos;t keep past portfolio values, so returns before your first snapshot can&apos;t be calculated; this is the money you put in or took out, and how often you traded.
      </p>
      <nav className="filter" aria-label="Months shown">
        {options.map(([v, label]) => (
          <a key={v} href={hrefFor(v)} aria-current={v === current ? "true" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div className="scroll">
        <table className="ledger">
          <caption>
            {shown.length} {shown.length === 1 ? "month" : "months"} with activity{rangeLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {ccys.map((c) => (
                <th scope="col" className="r" key={c}>Net money in ({c})</th>
              ))}
              <th scope="col" className="r">Buys</th>
              <th scope="col" className="r">Sells</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.month}>
                <td>{month(m.month)}</td>
                {ccys.map((c) => (
                  <td className={`r num ${isLoss(m.deposits[c]) ? "loss" : ""}`} key={c}>{amount(m.deposits[c], c)}</td>
                ))}
                <td className="r num">{m.buys}</td>
                <td className="r num">{m.sells}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {ccys.map((c) => (
                <td className={`r num ${isLoss(total(c)) ? "loss" : ""}`} key={c}>{amount(total(c), c)}</td>
              ))}
              <td className="r num">{shown.reduce((t, m) => t + m.buys, 0)}</td>
              <td className="r num">{shown.reduce((t, m) => t + m.sells, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="quiet xs" style={{ marginTop: "var(--space-3)" }}>
        Net money in counts deposits, withdrawals, bonuses and transfers from accounts Versus doesn&apos;t track (like chequing). Months with no activity are left out.
      </p>
    </section>
  );
}
