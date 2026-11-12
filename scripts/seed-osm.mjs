// Refreshes the OpenStreetMap snapshot bundled with the app (public/seed/yemen-osm.json).
// Run before a release:  npm run seed      (or: node scripts/seed-osm.mjs path/to/overpass.json)
import { readFileSync, writeFileSync } from 'node:fs'
import { overpassQuery, osmElementsToPlaces } from '../src/lib/osm.js'

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

async function fetchOverpass() {
  for (const url of MIRRORS) {
    try {
      console.log('Querying', url)
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery() }), signal: AbortSignal.timeout(150000) })
      if (res.ok) return await res.json()
      console.log('  ', res.status)
    } catch (e) { console.log('  ', e.message) }
  }
  throw new Error('All Overpass mirrors failed. Try again in a few minutes.')
}

const json = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await fetchOverpass()
const items = osmElementsToPlaces(json.elements)
const updatedAt = json.osm3s?.timestamp_osm_base || new Date().toISOString()
writeFileSync(new URL('../public/seed/yemen-osm.json', import.meta.url), JSON.stringify({ updatedAt, items }))
const by = items.reduce((m, p) => ((m[p.kind] = (m[p.kind] || 0) + 1), m), {})
console.log(`Saved ${items.length} places in Yemen`, by)
