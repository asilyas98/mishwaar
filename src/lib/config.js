export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const HAS_BACKEND = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
// Map tile servers, tried in order. If one is blocked on someone's network or browser
// (no tiles load at all), the map switches to the next one automatically.
const OSM_CREDIT = '© مساهمو <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
export const TILE_SOURCES = [
  ...(import.meta.env.VITE_TILE_URL
    ? [{ id: 'custom', url: import.meta.env.VITE_TILE_URL, attribution: import.meta.env.VITE_TILE_ATTRIBUTION || OSM_CREDIT }]
    : []),
  { id: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: 'abc', attribution: OSM_CREDIT },
  // Keyless backup for people who can't reach OpenStreetMap's server.
  { id: 'esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri — Esri, HERE, Garmin, © مساهمو OpenStreetMap' },
]
export const OVERPASS_URLS = (import.meta.env.VITE_OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',')
