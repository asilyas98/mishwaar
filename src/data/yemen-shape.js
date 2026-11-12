// Simplified outline of Yemen (Natural Earth, 1:110m), [lng, lat].
// Used to drop OpenStreetMap results that fall in Saudi Arabia, Oman or across the Red Sea,
// since Overpass is queried with a rectangle.
const OUTLINE = [[52.0,19.0],[52.782,17.35],[53.109,16.651],[52.385,16.382],[52.192,15.938],[52.168,15.597],[51.173,15.175],[49.575,14.709],[48.679,14.003],[48.239,13.948],[47.939,14.007],[47.354,13.592],[46.717,13.4],[45.878,13.348],[45.625,13.291],[45.406,13.027],[45.144,12.954],[44.99,12.7],[44.495,12.722],[44.175,12.586],[43.483,12.637],[43.223,13.221],[43.251,13.768],[43.088,14.063],[42.892,14.802],[42.605,15.213],[42.805,15.262],[42.702,15.719],[42.824,15.912],[42.779,16.348],[43.218,16.667],[43.116,17.088],[43.381,17.58],[43.792,17.32],[44.063,17.41],[45.217,17.433],[45.4,17.333],[46.367,17.233],[46.75,17.283],[47.0,16.95],[47.467,17.117],[48.183,18.167],[49.117,18.617],[52.0,19.0]]
// Indexes 1..29 of OUTLINE are coastline; points just offshore of them (ports, islands) still count.
const COAST_FROM = 1, COAST_TO = 29
const COAST_BUFFER_DEG = 0.15

function inside(lng, lat) {
  let c = false
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i], [xj, yj] = OUTLINE[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function isInYemen(lat, lng) {
  if (lat >= 12.1 && lat <= 12.8 && lng >= 52.0 && lng <= 54.6) return true // Socotra archipelago
  if (inside(lng, lat)) return true
  for (let i = COAST_FROM; i < COAST_TO; i++) {
    if (segDist(lng, lat, OUTLINE[i], OUTLINE[i + 1]) < COAST_BUFFER_DEG) return true
  }
  return false
}
