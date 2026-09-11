// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt eine der drei DWD-Synoptik-Seiten server-seitig ab und extrahiert
// den reinen Text-Bericht. Server-zu-server-Aufrufe unterliegen keinem
// Browser-CORS-Schutz und respektieren auch keine robots.txt (die ist nur
// eine Konvention für Suchmaschinen-Crawler, kein technischer Blockmechanismus).

const REPORTS = {
  morgen: 'https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_frueh.html?nn=499004',
  abend: 'https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_abd.html?nn=499004',
  mittelfrist: 'https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_mittelfrist.html?nn=499004'
};

function decodeEntities(str) {
  return str
    .replace(/&auml;/gi, 'ä').replace(/&Auml;/g, 'Ä')
    .replace(/&ouml;/gi, 'ö').replace(/&Ouml;/g, 'Ö')
    .replace(/&uuml;/gi, 'ü').replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/gi, 'ß')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractReportText(html) {
  // DWD-PlainTeaser-Seiten liefern den Rohtext meist in einem <pre>-Block.
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    return decodeEntities(preMatch[1]).trim();
  }

  // Fallback: den Hauptinhaltsbereich grob herausschneiden und alle
  // HTML-Tags entfernen, falls die Seite kein <pre> verwendet.
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const source = articleMatch ? articleMatch[1] : html;

  const stripped = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

  return decodeEntities(stripped).trim();
}

export default async function handler(req, res) {
  const report = req.query.report;
  const url = REPORTS[report];

  if (!url) {
    res.status(400).json({
      error: true,
      message: `Unbekannter Bericht "${report}". Erlaubt: morgen, abend, mittelfrist`
    });
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WasserGasDashboard/1.0)' }
    });

    if (!upstream.ok) {
      throw new Error(`DWD antwortete mit Status ${upstream.status}`);
    }

    const html = await upstream.text();
    const text = extractReportText(html);

    if (!text) {
      throw new Error('Kein Berichtstext gefunden');
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      report,
      text,
      quelle: 'Deutscher Wetterdienst (DWD)',
      abgerufenAm: new Date().toISOString()
    });

  } catch (error) {
    res.status(502).json({
      error: true,
      message: error.message || 'Unbekannter Fehler beim Abruf des DWD-Berichts'
    });
  }
}
