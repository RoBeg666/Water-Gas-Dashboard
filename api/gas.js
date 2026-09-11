// Vermittler-Funktion: läuft auf Vercel-Servern, nicht im Browser.
// Liefert zwei Ebenen:
// 1) Bundesweiter Füllstand von der Bundesnetzagentur (immer verfügbar, kein Key nötig)
// 2) Einzelne Speicheranlagen von AGSI+ (nur wenn die Umgebungsvariable
//    AGSI_API_KEY in den Vercel-Projekteinstellungen gesetzt ist)
//
// Der AGSI+-Key wird NIE im Code oder im Frontend sichtbar - er lebt
// ausschließlich als Vercel Environment Variable auf dem Server.

const CSV_URL = 'https://www.bundesnetzagentur.de/SiteGlobals/Functions/SVG/_functions/csv_export.html?view=renderCSV&id=870304';
const AGSI_BASE = 'https://agsi.gie.eu/api';

async function fetchNationalFromBNetzA() {
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

  return latest;
}

async function fetchGermanFacilityList(apiKey) {
  const listingRes = await fetch(`${AGSI_BASE}/about?show=listing`, {
    headers: { 'x-key': apiKey }
  });

  if (!listingRes.ok) {
    throw new Error(`AGSI+ Listing antwortete mit Status ${listingRes.status}`);
  }

  const listing = await listingRes.json();
  const companies = Array.isArray(listing) ? listing : (listing.data || []);

  const facilities = [];
  for (const company of companies) {
    if (!company || !Array.isArray(company.facilities)) continue;

    for (const facility of company.facilities) {
      if (facility.country !== 'DE') continue;

      facilities.push({
        name: facility.name,
        eic: facility.eic,
        companyEic: facility.company || company.eic
      });
    }
  }

  return facilities;
}

async function fetchFacilityCurrentValue(apiKey, facility) {
  const url = `${AGSI_BASE}?country=de&company=${encodeURIComponent(facility.companyEic)}&facility=${encodeURIComponent(facility.eic)}&size=1&reverse=true`;
  const res = await fetch(url, { headers: { 'x-key': apiKey } });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const json = await res.json();
  const entry = json.data && json.data[0];

  if (!entry || entry.full == null) {
    throw new Error('keine Daten');
  }

  return {
    name: facility.name,
    fuellstand: parseFloat(entry.full),
    stand: entry.gasDayStart,
    trend: entry.trend != null ? parseFloat(entry.trend) : 0,
    status: entry.status || null
  };
}

export default async function handler(req, res) {
  const apiKey = process.env.AGSI_API_KEY;

  try {
    const national = await fetchNationalFromBNetzA();

    let facilities = [];
    let facilitiesError = null;

    if (apiKey) {
      try {
        const facilityList = await fetchGermanFacilityList(apiKey);

        if (facilityList.length === 0) {
          facilitiesError = 'AGSI+ Listing enthielt keine deutschen Anlagen';
        } else {
          const results = await Promise.allSettled(
            facilityList.map(f => fetchFacilityCurrentValue(apiKey, f))
          );

          facilities = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value)
            .sort((a, b) => a.name.localeCompare(b.name, 'de'));

          if (facilities.length === 0) {
            facilitiesError = 'AGSI+ lieferte keine verwertbaren Einzelanlagen-Daten';
          }
        }
      } catch (err) {
        facilitiesError = err.message || 'Fehler beim Abruf der Einzelanlagen';
      }
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      datum: national.datum,
      fuellstand: national.fuellstand,
      minimum: national.minimum,
      maximum: national.maximum,
      ziel_1_november: 80,
      ziel_1_februar: 30,
      quelle: 'Bundesnetzagentur (AGSI+)',
      facilities,
      facilitiesError,
      facilitiesAvailable: Boolean(apiKey),
      abgerufenAm: new Date().toISOString()
    });

  } catch (error) {
    res.status(502).json({
      error: true,
      message: error.message || 'Unbekannter Fehler beim Abruf der Gasspeicher-Daten'
    });
  }
}
