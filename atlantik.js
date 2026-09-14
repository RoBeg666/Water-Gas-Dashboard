// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt die Maine-Climate-Office-Seite server-seitig ab und liefert sie
// unter unserer eigenen Domain aus. Direktes Einbetten der fremden Seite
// per <iframe src="https://mco.umaine.edu/..."> wurde vom Browser blockiert
// (vermutlich X-Frame-Options / CSP frame-ancestors der Zielseite).
// Da der Browser die Seite jetzt von UNSERER Domain lädt (nicht direkt von
// mco.umaine.edu), greift diese Framing-Sperre hier nicht mehr.

const TARGET_URL = 'https://mco.umaine.edu/climate/gom_sst/';

export default async function handler(req, res) {
  try {
    const upstream = await fetch(TARGET_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WasserGasDashboard/1.0)' }
    });

    if (!upstream.ok) {
      throw new Error(`Status ${upstream.status}`);
    }

    let html = await upstream.text();

    // <base>-Tag einfügen, damit relative Pfade (CSS/JS/Bilder) weiterhin
    // auf die Original-Domain zeigen und nicht auf unsere eigene.
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, match => `${match}\n<base href="${TARGET_URL}">`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    // Bewusst KEIN X-Frame-Options-Header setzen, damit unsere eigene
    // Seite dieses gespiegelte Dokument im iFrame zeigen darf.
    res.status(200).send(html);

  } catch (error) {
    res.status(502).send(
      `<div style="font-family: sans-serif; padding: 2rem; color: #333;">
        ⚠️ Seite konnte nicht geladen werden: ${String(error.message || error)}
      </div>`
    );
  }
}
