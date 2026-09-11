// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt live alle Stationen der wichtigsten Flüsse von PEGELONLINE ab.
// Direkter Browser-Zugriff auf pegelonline.wsv.de scheiterte an CORS -
// server-zu-server-Aufrufe sind davon nicht betroffen.
//
// Wichtig: der aktuelle Messwert steckt bei PEGELONLINE verschachtelt in
// einer "timeseries" (meist shortname "W" = Wasserstand). Ohne
// includeTimeseries=true bleibt currentMeasurement leer, auch wenn
// includeCurrentMeasurement=true gesetzt ist.

const WATERS = ['RHEIN', 'DONAU', 'ELBE', 'MAIN', 'WESER'];
const STATIONS_PER_WATER = 4;

function extractLevel(station) {
  if (!Array.isArray(station.timeseries)) return null;

  const ts = station.timeseries.find(t => t.shortname === 'W') || station.timeseries[0];
  if (!ts || !ts.currentMeasurement || typeof ts.currentMeasurement.value !== 'number') return null;

  return {
    level: ts.currentMeasurement.value,
    trend: ts.currentMeasurement.trend ?? 0
  };
}

export default async function handler(req, res) {
  const debug = [];

  try {
    const results = await Promise.allSettled(
      WATERS.map(water =>
        fetch(`https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=${water}&includeTimeseries=true&includeCurrentMeasurement=true`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WasserGasDashboard/1.0)' }
        })
          .then(r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            return r.json();
          })
          .then(stations => ({ water, stations }))
      )
    );

    const pegel = [];
    const failedWaters = [];

    results.forEach((result, idx) => {
      const water = WATERS[idx];

      if (result.status !== 'fulfilled') {
        failedWaters.push(water);
        debug.push({ water, error: String(result.reason && result.reason.message || result.reason) });
        return;
      }

      const rawCount = (result.value.stations || []).length;

      const stations = (result.value.stations || [])
        .map(s => {
          const measurement = extractLevel(s);
          return measurement ? { ...s, level: measurement.level, trend: measurement.trend } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b.km ?? 0) - (a.km ?? 0));

      debug.push({ water, rawCount, withMeasurement: stations.length });

      if (stations.length === 0) {
        failedWaters.push(water);
        return;
      }

      const step = Math.max(1, Math.floor(stations.length / STATIONS_PER_WATER));
      for (let i = 0; i < stations.length && pegel.filter(p => p.water === water).length < STATIONS_PER_WATER; i += step) {
        const s = stations[i];
        pegel.push({
          water,
          name: s.longname || s.shortname,
          level: s.level,
          trend: s.trend
        });
      }
    });

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      pegel,
      failedWaters,
      debug,
      abgerufenAm: new Date().toISOString()
    });

  } catch (error) {
    res.status(502).json({
      error: true,
      message: error.message || 'Unbekannter Fehler beim Abruf der Pegel-Daten',
      debug
    });
  }
}
