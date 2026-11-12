// All place and rating data. Everything is cached in IndexedDB so the app works offline,
// and refreshed from OpenStreetMap / Supabase whenever there is internet.
import { get, set } from 'idb-keyval'
import { supabase } from './supabase'
import { OVERPASS_URLS } from './config'
import { overpassQuery, osmElementsToPlaces, nearestGovernorate } from './osm.js'

const K = {
  osm: 'osm:places',
  community: 'community:places',
  roads: 'community:roads',
  summary: 'ratings:summary',
  mine: 'ratings:mine',
  queue: 'sync:queue',
}

export const isOnline = () => navigator.onLine

// ---------- OpenStreetMap ----------
export async function loadOsm() {
  const cached = await get(K.osm)
  if (cached) return cached
  // First run: use the snapshot bundled with the app (works with no internet).
  try {
    const res = await fetch('/seed/yemen-osm.json')
    if (res.ok) {
      const seed = await res.json()
      const data = { updatedAt: seed.updatedAt, items: seed.items }
      await set(K.osm, data)
      return data
    }
  } catch { /* offline with no seed */ }
  return { updatedAt: null, items: [] }
}

export async function refreshOsm() {
  let json = null
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery() }), signal: AbortSignal.timeout(60000) })
      if (res.ok) { json = await res.json(); break }
    } catch { /* try the next mirror */ }
  }
  if (!json) throw new Error('overpass unavailable')
  const items = osmElementsToPlaces(json.elements)
  // Never replace good data with an empty answer from a struggling server.
  if (!items.length) throw new Error('overpass empty')
  const data = { updatedAt: json.osm3s?.timestamp_osm_base || new Date().toISOString(), items }
  await set(K.osm, data)
  return data
}

// ---------- Places added by people using the app ----------
export async function loadCommunity() {
  return (await get(K.community)) || []
}

export async function refreshCommunity() {
  if (!supabase) return loadCommunity()
  const { data, error } = await supabase.from('places').select('id,category,kind,name,lat,lng,governorate,created_at').limit(20000)
  if (error) throw error
  const pending = ((await get(K.queue)) || []).filter((q) => q.type === 'place').map((q) => q.place)
  const items = [...data.map((r) => ({ ...r, id: `user:${r.id}`, source: 'community' })), ...pending]
  await set(K.community, items)
  return items
}

export async function addPlace({ category, kind, name, lat, lng }, user) {
  const uuid = crypto.randomUUID()
  const place = {
    id: `user:${uuid}`, source: 'community', category, kind, name, lat, lng,
    governorate: nearestGovernorate({ lat, lng }), created_by: user.id, pending: Boolean(supabase && !user.demo),
  }
  const items = await loadCommunity()
  items.push(place)
  await set(K.community, items)
  if (place.pending) {
    await enqueue({ type: 'place', place: { ...place }, uuid })
    sync()
  }
  return place
}

// ---------- Roads people draw (missing from the base map) ----------
export async function loadRoads() {
  return (await get(K.roads)) || []
}

export async function refreshRoads() {
  if (!supabase) return loadRoads()
  const { data, error } = await supabase.from('roads').select('id,name,points,governorate,created_by,created_at').limit(20000)
  if (error) throw error
  const pending = ((await get(K.queue)) || []).filter((q) => q.type === 'road').map((q) => q.road)
  const items = [...data.map((r) => ({ ...r, id: `road:${r.id}` })), ...pending]
  await set(K.roads, items)
  return items
}

export async function addRoad({ name, points }, user) {
  const uuid = crypto.randomUUID()
  const mid = points[Math.floor(points.length / 2)]
  const road = {
    id: `road:${uuid}`, name, points, created_by: user.id,
    governorate: nearestGovernorate({ lat: mid[0], lng: mid[1] }), created_at: new Date().toISOString(),
    pending: Boolean(supabase && !user.demo),
  }
  const items = await loadRoads()
  items.push(road)
  await set(K.roads, items)
  if (road.pending) {
    await enqueue({ type: 'road', road: { ...road }, uuid })
    sync()
  }
  return road
}

export async function deleteRoad(id, user) {
  const items = (await loadRoads()).filter((r) => r.id !== id)
  await set(K.roads, items)
  if (supabase && !user.demo) {
    const q = ((await get(K.queue)) || []).filter((x) => !(x.type === 'road' && x.road.id === id))
    await set(K.queue, q)
    await enqueue({ type: 'road-delete', uuid: id.slice(5) })
    sync()
  }
  return items
}

// ---------- Ratings ----------
export async function loadRatings() {
  return { summary: (await get(K.summary)) || {}, mine: (await get(K.mine)) || {} }
}

export async function refreshRatings(user) {
  if (!supabase) return loadRatings()
  const { data, error } = await supabase.from('place_rating_summary').select('place_id,avg_stars,count')
  if (error) throw error
  const summary = {}
  for (const r of data) summary[r.place_id] = { avg: Number(r.avg_stars), count: r.count }
  await set(K.summary, summary)
  let mine = (await get(K.mine)) || {}
  if (user && !user.demo) {
    const { data: my } = await supabase.from('ratings').select('place_id,stars').eq('user_id', user.id)
    if (my) {
      mine = Object.fromEntries(my.map((r) => [r.place_id, r.stars]))
      // keep ratings that are still waiting to upload
      for (const q of (await get(K.queue)) || []) if (q.type === 'rating') mine[q.placeId] = q.stars
      await set(K.mine, mine)
    }
  }
  return { summary, mine }
}

export async function rate(placeId, stars, user) {
  const { summary, mine } = await loadRatings()
  const prev = mine[placeId]
  const s = summary[placeId] || { avg: 0, count: 0 }
  const total = s.avg * s.count - (prev || 0) + stars
  const count = s.count + (prev ? 0 : 1)
  summary[placeId] = { avg: total / count, count }
  mine[placeId] = stars
  await set(K.summary, summary)
  await set(K.mine, mine)
  if (supabase && !user.demo) {
    await enqueue({ type: 'rating', placeId, stars })
    sync()
  }
  return { summary, mine }
}

// ---------- Offline queue ----------
async function enqueue(item) {
  const q = (await get(K.queue)) || []
  if (item.type === 'rating') {
    const i = q.findIndex((x) => x.type === 'rating' && x.placeId === item.placeId)
    if (i >= 0) q.splice(i, 1)
  }
  q.push({ ...item, at: Date.now() })
  await set(K.queue, q)
}

export async function pendingCount() {
  return ((await get(K.queue)) || []).length
}

let syncing = false
export async function sync() {
  if (!supabase || syncing || !isOnline()) return
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user?.id
  if (!uid) return
  syncing = true
  try {
    let q = (await get(K.queue)) || []
    const left = []
    for (const item of q) {
      try {
        if (item.type === 'place') {
          const p = item.place
          const { error } = await supabase.from('places').upsert({
            id: item.uuid, category: p.category, kind: p.kind, name: p.name,
            lat: p.lat, lng: p.lng, governorate: p.governorate, created_by: uid,
          })
          if (error) throw error
        } else if (item.type === 'road') {
          const r = item.road
          const { error } = await supabase.from('roads').upsert({
            id: item.uuid, name: r.name, points: r.points, governorate: r.governorate, created_by: uid,
          })
          if (error) throw error
        } else if (item.type === 'road-delete') {
          const { error } = await supabase.from('roads').delete().eq('id', item.uuid)
          if (error) throw error
        } else if (item.type === 'rating') {
          const { error } = await supabase.from('ratings').upsert(
            { place_id: item.placeId, user_id: uid, stars: item.stars, updated_at: new Date().toISOString() },
            { onConflict: 'place_id,user_id' },
          )
          if (error) throw error
        }
      } catch {
        left.push(item)
      }
    }
    await set(K.queue, left)
  } finally {
    syncing = false
  }
}
