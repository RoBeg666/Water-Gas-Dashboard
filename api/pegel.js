// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Holt eine kuratierte Liste bekannter Leitpegel (statt automatischer
// Streuung über den Flusslauf) inklusive kennzeichnender Wasserstände
// (Mittelwasser MW, Gleichwertiger Wasserstand GlW), um Abweichung vom
// Mittel und Abstand zum GlW (Fahrrinnentiefe-Referenz) anzuzeigen.
//
// Direkter Browser-Zugriff auf pegelonline.wsv.de scheiterte an CORS -
// deshalb server-seitig. Der Messwert steckt verschachtelt in einer
// "timeseries" (shortname "W" = Wasserstand); ohne includeTimeseries=true
// bleibt er leer, auch mit includeCurrentMeasurement=true gesetzt.

const WATERS = ['RHEIN', 'DONAU', 'ELBE', 'MAIN', 'MOSEL'];

// Kuratierte, bekannte Leitpegel je Gewässer (Namen wie bei WSV/PEGELONLINE
// üblich, Groß-/Kleinschreibung wird beim Abgleich ignoriert).
const LEITPEGEL = {
  RHEIN: ['KAUB', 'KÖLN', 'DÜSSELDORF', 'DUISBURG-RUHRORT', 'WESEL', 'EMMERICH', 'KOBLENZ', 'MAINZ', 'MANNHEIM', 'WORMS', 'MAXAU'],
  DONAU: ['PASSAU DONAU', 'REGENSBURG EISERNE BRÜCKE', 'KELHEIM DONAU', 'INGOLSTADT LUITPOLDSTRASSE', 'DEGGENDORF', 'VILSHOFEN'],
  ELBE: ['DRESDEN', 'TORGAU', 'WITTENBERGE', 'NEU DARCHAU', 'SCHÖNA'],
  MAIN: ['WÜRZBURG', 'FRANKFURT OSTHAFEN'],
  MOSEL: ['COCHEM', 'KOBLENZ OP']
};

function norm(s) {
  return (s || '').trim().toUpperCase();
}

function extractMeasurementAndMarks(station) {
  if (!Array.isArray(station.timeseries)) return null;

  const ts = station.timeseries.find(t => t.shortname === 'W') || station.timeseries[0];
  if (!ts || !ts.currentMeasurement || typeof ts.currentMeasurement.value !== 'number') return null;

  const level = ts.currentMeasurement.value;
  const trend = ts.currentMeasurement.trend ?? 0;

  let mw = null;
  let glw = null;

  if (Array.isArray(ts.characteristicValues)) {
    const mwEntry = ts.characteristicValues.find(c => c.shortname === 'MW');
    const glwEntry = ts.characteristicValues.find(c => c.shortname === 'GlW');
    if (mwEntry) mw = mwEntry.value;
    if (glwEntry) glw = glwEntry.value;
  }

  return {
    level,
    trend,
    abwMittel: mw != null ? level - mw : null,
    ueberGlW: glw != null ? level - glw : null
  };
}

export default async function handler(req, res) {
  const debug = [];

  try {
    const results = await Promise.allSettled(
      WATERS.map(water =>
        fetch(`https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=${water}&includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true`, {
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
    const notFound = [];

    results.forEach((result, idx) => {
      const water = WATERS[idx];
      const targets = (LEITPEGEL[water] || []).map(norm);

      if (result.status !== 'fulfilled') {
        failedWaters.push(water);
        debug.push({ water, error: String(result.reason && result.reason.message || result.reason) });
        return;
      }

      const stations = result.value.stations || [];
      let foundCount = 0;

      targets.forEach(target => {
        const station = stations.find(s => norm(s.shortname) === target || norm(s.longname) === target);

        if (!station) {
          notFound.push(`${water}:${target}`);
          return;
        }

        const measurement = extractMeasurementAndMarks(station);

        if (!measurement) {
          notFound.push(`${water}:${target} (kein Messwert)`);
          return;
        }

        foundCount++;
        pegel.push({
          water,
          name: station.longname || station.shortname,
          level: measurement.level,
          trend: measurement.trend,
          abwMittel: measurement.abwMittel,
          ueberGlW: measurement.ueberGlW
        });
      });

      debug.push({ water, targets: targets.length, found: foundCount });

      if (foundCount === 0) {
        failedWaters.push(water);
      }
    });

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      pegel,
      failedWaters,
      notFound,
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
