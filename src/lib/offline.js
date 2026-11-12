// "Save this area": downloads the map tiles for what is on screen (plus two closer zoom
// levels) so the service worker keeps them for use without internet.
const MAX_TILES = 400

function lng2x(lng, z) { return Math.floor(((lng + 180) / 360) * 2 ** z) }
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export function tilesForBounds(bounds, zMin, zMax) {
  const tiles = []
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lng2x(bounds.getWest(), z), x1 = lng2x(bounds.getEast(), z)
    const y0 = lat2y(bounds.getNorth(), z), y1 = lat2y(bounds.getSouth(), z)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y })
  }
  return tiles
}

export async function saveArea(map, source, onProgress) {
  const tileUrl = source.url
  const z = Math.round(map.getZoom())
  let zMax = Math.min(z + 2, 17)
  let tiles = tilesForBounds(map.getBounds(), z, zMax)
  while (tiles.length > MAX_TILES && zMax > z) {
    zMax--
    tiles = tilesForBounds(map.getBounds(), z, zMax)
  }
  if (tiles.length > MAX_TILES) throw new Error('too-large')
  let done = 0
  const sub = (source.subdomains || 'abc').split('')
  const queue = [...tiles]
  async function worker() {
    while (queue.length) {
      const t = queue.shift()
      const url = tileUrl.replace('{s}', sub[(t.x + t.y) % sub.length]).replace('{r}', '').replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y)
      try { await fetch(url, { mode: 'cors' }) } catch { /* skip */ }
      done++
      onProgress?.(done, tiles.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return tiles.length
}
