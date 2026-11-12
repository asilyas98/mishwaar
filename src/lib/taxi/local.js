// Demo-mode taxi backend: everything lives in this browser (localStorage) and changes are
// broadcast to other tabs, so a rider tab and a driver tab can talk to each other.
const KEY = 'mishwaar:demo-taxi'
const OPEN_FOR_MS = 30 * 60 * 1000
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mishwaar-taxi') : null
const listeners = new Set()

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { rides: [], messages: [], drivers: {} } } catch { return { rides: [], messages: [], drivers: {} } }
}
function save(db, event) {
  localStorage.setItem(KEY, JSON.stringify(db))
  listeners.forEach((cb) => cb(event))
  channel?.postMessage(event)
}
channel?.addEventListener('message', (e) => listeners.forEach((cb) => cb(e.data)))

const now = () => new Date().toISOString()
const LIVE = ['requested', 'accepted', 'arrived']

function sysMessage(db, rideId, body) {
  const m = { id: crypto.randomUUID(), rideId, senderId: null, kind: 'system', body, createdAt: now() }
  db.messages.push(m)
  return m
}

export const localTaxi = {
  demo: true,

  async getDriver(user) {
    return load().drivers[user.id] || null
  },

  async registerDriver(user, info, file) {
    const db = load()
    // Demo mode approves drivers straight away. With Supabase, an admin approves them.
    db.drivers[user.id] = { id: user.id, ...info, docName: file?.name || '', status: 'approved', online: false, createdAt: now() }
    save(db, { type: 'driver' })
    return db.drivers[user.id]
  },

  async setDriverOnline(user, online, pos) {
    const db = load()
    const d = db.drivers[user.id]
    if (!d) return null
    Object.assign(d, { online, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) })
    save(db, { type: 'driver' })
    return d
  },

  async updateDriverPosition(user, pos, rideId) {
    const db = load()
    const d = db.drivers[user.id]
    if (d) Object.assign(d, { lat: pos.lat, lng: pos.lng })
    const r = rideId && db.rides.find((x) => x.id === rideId && x.driverId === user.id)
    if (r) r.driverPos = { lat: pos.lat, lng: pos.lng }
    save(db, { type: 'ride', ride: r })
  },

  async currentRide(user) {
    const mine = load().rides.filter((r) => r.customerId === user.id || r.driverId === user.id)
    return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null
  },

  async openRequests(user) {
    const cutoff = Date.now() - OPEN_FOR_MS
    return load().rides.filter((r) => r.status === 'requested' && r.customerId !== user.id && Date.parse(r.createdAt) > cutoff)
  },

  async requestRide(user, { pickup, pickupNote, destination }) {
    const db = load()
    if (db.rides.some((r) => r.customerId === user.id && LIVE.includes(r.status))) throw new Error('لديك طلب جارٍ بالفعل.')
    const ride = {
      id: crypto.randomUUID(), status: 'requested', customerId: user.id, customerName: user.name, customerPhone: '',
      driverId: null, pickup, pickupNote, destination, driverPos: null, cancelReason: '', cancelledBy: null, createdAt: now(),
    }
    db.rides.push(ride)
    save(db, { type: 'ride', ride })
    return ride
  },

  async acceptRide(user, rideId) {
    const db = load()
    const r = db.rides.find((x) => x.id === rideId)
    const d = db.drivers[user.id]
    if (!d || d.status !== 'approved') return { ok: false, reason: 'not-driver' }
    if (!r || r.status !== 'requested') return { ok: false, reason: 'taken' }
    const customer = Object.values(JSON.parse(localStorage.getItem('mishwaar:demo-accounts') || '{}')).find((a) => a.id === r.customerId)
    Object.assign(r, {
      status: 'accepted', driverId: user.id, driverName: user.name, driverPhone: d.phone, driverCar: [d.carModel, d.carColor].filter(Boolean).join(' · '),
      driverPlate: d.plate, customerPhone: customer?.phone || '', acceptedAt: now(), cancelReason: '', cancelledBy: null,
      driverPos: d.lat != null ? { lat: d.lat, lng: d.lng } : null,
    })
    sysMessage(db, r.id, `قبل ${user.name} الطلب وهو في الطريق.`)
    save(db, { type: 'ride', ride: r })
    return { ok: true, ride: r }
  },

  async cancelRide(user, rideId, reason) {
    const db = load()
    const r = db.rides.find((x) => x.id === rideId)
    if (!r || !LIVE.includes(r.status)) return
    if (r.driverId === user.id) {
      // Driver backs out: the request opens again for other drivers.
      sysMessage(db, r.id, `ألغى السائق ${user.name}: ${reason || 'بدون سبب'}`)
      Object.assign(r, { status: 'requested', driverId: null, driverName: '', driverPhone: '', driverCar: '', driverPlate: '', driverPos: null, customerPhone: '', cancelReason: reason, cancelledBy: 'driver' })
    } else if (r.customerId === user.id) {
      sysMessage(db, r.id, `ألغى الراكب الطلب: ${reason || 'بدون سبب'}`)
      Object.assign(r, { status: 'cancelled', cancelReason: reason, cancelledBy: 'customer' })
    }
    save(db, { type: 'ride', ride: r })
  },

  async markArrived(user, rideId) {
    const db = load()
    const r = db.rides.find((x) => x.id === rideId && x.driverId === user.id && x.status === 'accepted')
    if (!r) return
    Object.assign(r, { status: 'arrived', arrivedAt: now() })
    sysMessage(db, r.id, 'وصل السائق إلى مكان الراكب.')
    save(db, { type: 'ride', ride: r })
  },

  async completeRide(user, rideId) {
    const db = load()
    const r = db.rides.find((x) => x.id === rideId && (x.driverId === user.id || x.customerId === user.id) && x.status === 'arrived')
    if (!r) return
    Object.assign(r, { status: 'completed', completedAt: now() })
    sysMessage(db, r.id, 'انتهت الرحلة.')
    save(db, { type: 'ride', ride: r })
  },

  async messages(rideId) {
    return load().messages.filter((m) => m.rideId === rideId)
  },

  async sendMessage(user, rideId, body) {
    const db = load()
    const m = { id: crypto.randomUUID(), rideId, senderId: user.id, kind: 'text', body, createdAt: now() }
    db.messages.push(m)
    save(db, { type: 'message', message: m })
    return m
  },

  subscribe(_user, cb) {
    listeners.add(cb)
    const onStorage = (e) => e.key === KEY && cb({ type: 'sync' })
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
  },
}
