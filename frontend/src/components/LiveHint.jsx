// Broadcast-style callout for the live-streaming verdicts feature: pulsing LIVE dot,
// a one-line promise, and an animated tick-wave suggesting results flowing in.
export default function LiveHint() {
  return (
    <div className="livecall">
      <span className="livedot" />
      <div style={{ flex: 1 }}>
        <b style={{ fontSize: 13.5 }}>Verdicts stream in <span className="livetxt">LIVE</span></b>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          Each project's verdict lands the moment it's verified - watch the grid fill in
          real time instead of waiting for the whole batch.
        </div>
        <div className="liveticks"><i /><i /><i /><i /><i /><i /></div>
      </div>
      <img className="astro" src="/hackjudge-mark.svg" alt="" style={{ height: 34 }} />
    </div>
  )
}
