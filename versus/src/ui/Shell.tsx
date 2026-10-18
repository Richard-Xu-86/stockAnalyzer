/** Page frame: wordmark, an optional right-hand slot, and the data-sources footer. */
export function Shell({ children, right, footer }: { children: React.ReactNode; right?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="page">
      <header className="topbar">
        <a className="wordmark" href="/">
          Versus <span>you and the market</span>
        </a>
        {right}
      </header>
      <main>{children}</main>
      <footer className="foot quiet xs">
        {footer}
        <p>
          Prices and holdings come from your broker through SnapTrade, recorded after each weekday close. The S&amp;P 500 and TSX are tracked through SPY and XIC, which include their fees. US and Canadian dollars are converted at the Bank of Canada daily rate. Not investment advice.
        </p>
      </footer>
    </div>
  );
}
