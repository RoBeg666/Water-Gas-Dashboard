// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt live alle Stationen der wichtigsten Flüsse von PEGELONLINE ab.
// Direkter Browser-Zugriff auf pegelonline.wsv.de scheiterte an CORS -
// server-zu-server-Aufrufe sind davon nicht betroffen.

const WATERS = ['RHEIN', 'DONAU', 'ELBE', 'MAIN', 'WESER'];
const STATIONS_PER_WATER = 4;

export default async function handler(req, res) {
  try {
    const results = await Promise.allSettled(
      WATERS.map(water =>
        fetch(`https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=${water}&includeCurrentMeasurement=true`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WasserGasDashboard/1.0)' }
        })
          .then(r => {
            if (!r.ok) throw new Error(`${water}: Status ${r.status}`);
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
        return;
      }

      const stations = (result.value.stations || [])
        .filter(s => s.currentMeasurement && typeof s.currentMeasurement.value === 'number')
        .sort((a, b) => (b.km ?? 0) - (a.km ?? 0));

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
          level: s.currentMeasurement.value,
          trend: s.currentMeasurement.trend ?? 0
        });
      }
    });

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      pegel,
      failedWaters,
      abgerufenAm: new Date().toISOString()
    });

  } catch (error) {
    res.status(502).json({
      error: true,
      message: error.message || 'Unbekannter Fehler beim Abruf der Pegel-Daten'
    });
  }
}
