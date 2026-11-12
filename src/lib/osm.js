// Pure helpers for OpenStreetMap data, shared by the app and scripts/seed-osm.mjs.
import { CATEGORIES, kindFromOsmTags } from '../data/categories.js'
import { GOVERNORATES, YEMEN_BBOX } from '../data/governorates.js'
import { isInYemen } from '../data/yemen-shape.js'

// Best guess of a place's governorate: the nearest governorate town. Anything within
// ~20 km of central Sana'a is treated as the capital (Amanat al-Asimah).
function nearestGovernorate(p) {
  const k = Math.cos((p.lat * Math.PI) / 180)
  const d2 = (lat, lng) => (lat - p.lat) ** 2 + ((lng - p.lng) * k) ** 2
  const cap = GOVERNORATES[0]
  if (d2(cap.lat, cap.lng) < 0.18 ** 2) return cap.id
  let best = cap, bd = Infinity
  for (const g of GOVERNORATES) {
    for (const [lat, lng] of [[g.lat, g.lng], ...(g.extra || [])]) {
      const d = d2(lat, lng)
      if (d < bd) { bd = d; best = g }
    }
  }
  return best.id
}
export { nearestGovernorate }

export function overpassQuery(bbox = YEMEN_BBOX) {
  const b = bbox.join(',')
  const parts = [...CATEGORIES.bus.overpass, ...CATEGORIES.moto.overpass].map((q) => `${q}(${b});`).join('')
  return `[out:json][timeout:120];(${parts});out center tags;`
}

export function osmElementsToPlaces(elements) {
  const out = []
  for (const e of elements) {
    const t = e.tags || {}
    const [category, kind] = kindFromOsmTags(t)
    if (!category) continue
    const lat = e.lat ?? e.center?.lat
    const lng = e.lon ?? e.center?.lon
    if (lat == null || !isInYemen(lat, lng)) continue
    out.push({
      id: `osm:${e.type[0]}${e.id}`,
      source: 'osm',
      category, kind,
      name: t['name:ar'] || t.name || '',
      nameAlt: t['name:en'] && t['name:en'] !== (t['name:ar'] || t.name) ? t['name:en'] : '',
      phone: t.phone || t['contact:phone'] || '',
      hours: t.opening_hours || '',
      lat: +lat.toFixed(6), lng: +lng.toFixed(6),
      governorate: nearestGovernorate({ lat, lng }),
    })
  }
  return out
}
