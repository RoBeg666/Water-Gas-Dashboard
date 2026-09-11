// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt die öffentliche CSV-Datei der Bundesnetzagentur (Gasspeicher-Füllstände)
// und gibt den aktuellsten Wert als JSON zurück. Da der Aufruf server-zu-server
// läuft, greift hier kein Browser-CORS-Schutz.

const CSV_URL = 'https://www.bundesnetzagentur.de/SiteGlobals/Functions/SVG/_functions/csv_export.html?view=renderCSV&id=870304';

export default async function handler(req, res) {
  try {
    const upstream = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WasserGasDashboard/1.0)' }
    });

    if (!upstream.ok) {
      throw new Error(`Bundesnetzagentur antwortete mit Status ${upstream.status}`);
    }

    const csvText = await upstream.text();
    const lines = csvText.trim().split('\n').filter(Boolean);

    if (lines.length < 2) {
      throw new Error('CSV enthält keine Datenzeilen');
    }

    // Spalten: Datum;Vorjahres-Saison;aktuelle Saison;Minimum;Maximum
    // Wir suchen die letzte Zeile, in der die "aktuelle Saison"-Spalte gefüllt ist.
    let latest = null;

    for (const line of lines.slice(1)) {
      const parts = line.split(';');
      if (parts.length < 4) continue;

      const [datum, , aktuelleSaison, minimum, maximum] = parts;

      if (aktuelleSaison && aktuelleSaison.trim() !== '') {
        latest = {
          datum: datum.trim(),
          fuellstand: parseFloat(aktuelleSaison.trim().replace(',', '.')),
          minimum: parseFloat((minimum || '').trim().replace(',', '.')) || null,
          maximum: parseFloat((maximum || '').trim().replace(',', '.')) || null
        };
      }
    }

    if (!latest) {
      throw new Error('Kein aktueller Füllstand in der CSV gefunden');
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      datum: latest.datum,
      fuellstand: latest.fuellstand,
      minimum: latest.minimum,
      maximum: latest.maximum,
      ziel_1_november: 80,
      ziel_1_februar: 30,
      quelle: 'Bundesnetzagentur (AGSI+)',
      abgerufenAm: new Date().toISOString()
    });

  } catch (error) {
    res.status(502).json({
      error: true,
      message: error.message || 'Unbekannter Fehler beim Abruf der Gasspeicher-Daten'
    });
  }
}
