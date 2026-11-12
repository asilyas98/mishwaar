import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_SOURCES } from '../lib/config'
import { YEMEN_CENTER } from '../data/governorates'

// Marker look: `kind` picks the colour (see .pin-* in styles.css). Big markers are used
// for the selected place and for taxi pickup / driver positions.
function pinIcon({ kind, selected, pending, big, label }) {
  const size = selected || big ? 26 : 16
  return L.divIcon({
    className: '',
    html: `<span class="pin pin-${kind}${selected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}${big ? ' is-big' : ''}">${label || ''}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const SOURCE_KEY = 'mishwaar:tiles-v2'
function startSource() {
  try {
    const i = TILE_SOURCES.findIndex((t) => t.id === localStorage.getItem(SOURCE_KEY))
    return i >= 0 ? i : 0
  } catch { return 0 }
}

// Adds tiles from TILE_SOURCES[i]. If that server is unreachable (several errors and not
// a single tile loaded), falls back to the next server and remembers the choice.
function addTiles(m, i) {
  const src = TILE_SOURCES[i]
  const layer = L.tileLayer(src.url, { maxZoom: 19, attribution: src.attribution, subdomains: src.subdomains || 'abc', crossOrigin: true })
  let loaded = 0, failed = 0
  layer.on('tileload', () => {
    if (loaded++ === 0) try { localStorage.setItem(SOURCE_KEY, src.id) } catch { /* ignore */ }
  })
  layer.on('tileerror', () => {
    failed++
    if (loaded === 0 && failed >= 4 && navigator.onLine) {
      layer.off(); m.removeLayer(layer)
      m.attributionControl?.removeAttribution(src.attribution)
      addTiles(m, (i + 1) % TILE_SOURCES.length)
    }
  })
  layer.addTo(m)
  m.tileSource = src
}

/**
 * markers: [{ id, lat, lng, kind, selected?, pending?, big?, label? }]
 * lines:   [{ id, points: [[lat, lng], ...], selected?, draft? }]   (roads people drew)
 */
export default function MapView({ markers, lines, onMarkerClick, onLineClick, userPos, flyTo, crosshair, onMapClick, mapRef }) {
  const el = useRef(null)
  const map = useRef(null)
  const markerLayer = useRef(null)
  const lineLayer = useRef(null)
  const userLayer = useRef(null)
  const cb = useRef({})
  cb.current = { onMapClick, onMarkerClick, onLineClick }

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(YEMEN_CENTER, 6)
    L.control.zoom({ position: 'bottomleft' }).addTo(m)
    addTiles(m, startSource())
    m.attributionControl.setPrefix(false)
    lineLayer.current = L.layerGroup().addTo(m)
    markerLayer.current = L.layerGroup().addTo(m)
    userLayer.current = L.layerGroup().addTo(m)
    m.on('click', (e) => cb.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    if (mapRef) mapRef.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    const g = markerLayer.current
    g.clearLayers()
    for (const p of markers || []) {
      const mk = L.marker([p.lat, p.lng], { icon: pinIcon(p), keyboard: false, interactive: !!p.id, zIndexOffset: p.selected || p.big ? 1000 : 0 })
      if (p.id) mk.on('click', (e) => { L.DomEvent.stopPropagation(e); cb.current.onMarkerClick?.(p.id) })
      g.addLayer(mk)
    }
  }, [markers])

  useEffect(() => {
    const g = lineLayer.current
    g.clearLayers()
    for (const r of lines || []) {
      if (r.points.length < 1) continue
      if (r.draft) {
        L.polyline(r.points, { className: 'road-line is-draft', weight: 5, interactive: false }).addTo(g)
        r.points.forEach((pt) => L.circleMarker(pt, { radius: 5, className: 'road-vertex', interactive: false }).addTo(g))
        continue
      }
      // wide invisible line underneath makes thin roads easy to tap
      const hit = L.polyline(r.points, { weight: 18, opacity: 0, className: 'road-hit' })
      hit.on('click', (e) => { L.DomEvent.stopPropagation(e); cb.current.onLineClick?.(r.id) })
      hit.addTo(g)
      L.polyline(r.points, { className: `road-line${r.selected ? ' is-selected' : ''}${r.pending ? ' is-pending' : ''}`, weight: r.selected ? 7 : 5, interactive: false }).addTo(g)
    }
  }, [lines])

  useEffect(() => {
    userLayer.current.clearLayers()
    if (!userPos) return
    if (userPos.acc) L.circle([userPos.lat, userPos.lng], { radius: userPos.acc, className: 'user-acc', interactive: false }).addTo(userLayer.current)
    L.marker([userPos.lat, userPos.lng], { icon: L.divIcon({ className: '', html: '<span class="user-dot"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(userLayer.current)
  }, [userPos])

  useEffect(() => {
    if (flyTo && map.current) map.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom || 15, { duration: 0.8 })
  }, [flyTo])

  return <div ref={el} className={`map${crosshair ? ' is-adding' : ''}`} role="application" aria-label="الخريطة" />
}
