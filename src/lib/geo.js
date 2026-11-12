const R = 6371000
const rad = (d) => (d * Math.PI) / 180

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]).replace('.', '٫')

export function formatDistance(m) {
  if (m == null) return ''
  if (m < 1000) return `${arNum(Math.round(m / 10) * 10)} م`
  const km = m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)
  return `${arNum(km)} كم`
}

// Compass direction (in Arabic) from a to b, useful offline when there is no routing.
export function bearingLabel(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  const names = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب']
  return names[Math.round(deg / 45) % 8]
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  })
}
