export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 700, margin: "4rem auto", padding: 20 }}>
      <h1>Voice API</h1>
      <p>The private voice endpoint is <code>POST /api/voice</code>.</p>
      <p>The public <code>GET /api/voice</code> health check does not test OpenRouter or ElevenLabs.</p>
    </main>
  );
}
