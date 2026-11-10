export function Soon({ title, children }: { title: string; children: string }) {
  return (
    <section className="ad-page">
      <h1>{title}</h1>
      <div className="ad-card ad-soon">
        <span className="ad-pill">Coming next</span>
        <p>{children}</p>
      </div>
    </section>
  );
}
