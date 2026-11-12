// Supabase taxi backend. All state changes go through database functions (see
// supabase/schema.sql) so that, for example, only one driver can win a request.
import { supabase } from '../supabase'

const OPEN_FOR_MS = 30 * 60 * 1000

const toRide = (r) => r && ({
  id: r.id, status: r.status,
  customerId: r.customer_id, customerName: r.customer_name, customerPhone: r.customer_phone || '',
  driverId: r.driver_id, driverName: r.driver_name || '', driverPhone: r.driver_phone || '', driverCar: r.driver_car || '', driverPlate: r.driver_plate || '',
  pickup: { lat: r.pickup_lat, lng: r.pickup_lng }, pickupNote: r.pickup_note || '', destination: r.destination || '',
  driverPos: r.driver_lat != null ? { lat: r.driver_lat, lng: r.driver_lng } : null,
  cancelReason: r.cancel_reason || '', cancelledBy: r.cancelled_by,
  createdAt: r.created_at, acceptedAt: r.accepted_at, arrivedAt: r.arrived_at, completedAt: r.completed_at,
})
const toMsg = (m) => ({ id: m.id, rideId: m.ride_id, senderId: m.sender_id, kind: m.kind, body: m.body, createdAt: m.created_at })
const toDriver = (d) => d && ({
  id: d.id, phone: d.phone, carModel: d.car_model, carColor: d.car_color, plate: d.plate,
  docType: d.doc_type, docNumber: d.doc_number, status: d.status, online: d.online, lat: d.lat, lng: d.lng,
})

function check({ data, error }) {
  if (error) throw new Error(error.message?.startsWith('mishwaar:') ? error.message.slice(9).trim() : 'تعذّر إكمال الطلب. تحقق من اتصالك بالإنترنت ثم حاول مجددًا.')
  return data
}

export const remoteTaxi = {
  demo: false,

  async getDriver(user) {
    return toDriver(check(await supabase.from('drivers').select('*').eq('id', user.id).maybeSingle()))
  },

  async registerDriver(user, info, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${user.id}/${info.docType}-${Date.now()}.${ext}`
    const up = await supabase.storage.from('driver-docs').upload(path, file, { upsert: false, contentType: file.type })
    if (up.error) throw new Error('تعذّر رفع صورة الوثيقة. جرّب صورة أصغر أو تحقق من الإنترنت.')
    const row = {
      id: user.id, phone: info.phone, car_model: info.carModel, car_color: info.carColor, plate: info.plate,
      doc_type: info.docType, doc_number: info.docNumber, doc_path: path,
    }
    return toDriver(check(await supabase.from('drivers').upsert(row).select().single()))
  },

  async setDriverOnline(user, online, pos) {
    const patch = { online, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}), updated_at: new Date().toISOString() }
    return toDriver(check(await supabase.from('drivers').update(patch).eq('id', user.id).select().single()))
  },

  async updateDriverPosition(user, pos, rideId) {
    check(await supabase.rpc('update_driver_position', { p_lat: pos.lat, p_lng: pos.lng, p_ride: rideId || null }))
  },

  async currentRide(user) {
    const rows = check(await supabase.from('rides').select('*')
      .or(`customer_id.eq.${user.id},driver_id.eq.${user.id}`)
      .order('created_at', { ascending: false }).limit(1))
    return toRide(rows[0]) || null
  },

  async openRequests() {
    const since = new Date(Date.now() - OPEN_FOR_MS).toISOString()
    const rows = check(await supabase.from('rides').select('*').eq('status', 'requested').gt('created_at', since).order('created_at'))
    return rows.map(toRide)
  },

  async requestRide(_user, { pickup, pickupNote, destination }) {
    return toRide(check(await supabase.rpc('request_ride', { p_lat: pickup.lat, p_lng: pickup.lng, p_note: pickupNote, p_destination: destination })))
  },

  async acceptRide(_user, rideId) {
    const r = check(await supabase.rpc('accept_ride', { p_ride: rideId }))
    // The function returns an empty row when another driver got there first.
    return r?.id ? { ok: true, ride: toRide(r) } : { ok: false, reason: 'taken' }
  },

  async cancelRide(_user, rideId, reason) {
    check(await supabase.rpc('cancel_ride', { p_ride: rideId, p_reason: reason }))
  },

  async markArrived(_user, rideId) {
    check(await supabase.rpc('mark_arrived', { p_ride: rideId }))
  },

  async completeRide(_user, rideId) {
    check(await supabase.rpc('complete_ride', { p_ride: rideId }))
  },

  async messages(rideId) {
    return check(await supabase.from('ride_messages').select('*').eq('ride_id', rideId).order('created_at')).map(toMsg)
  },

  async sendMessage(user, rideId, body) {
    return toMsg(check(await supabase.from('ride_messages').insert({ ride_id: rideId, sender_id: user.id, body }).select().single()))
  },

  subscribe(user, cb) {
    const ch = supabase
      .channel(`taxi-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (p) => cb({ type: 'ride', ride: toRide(p.new) }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages' }, (p) => cb({ type: 'message', message: toMsg(p.new) }))
      .subscribe()
    // Realtime can miss events while a phone sleeps; refresh when the app comes back.
    const wake = () => document.visibilityState === 'visible' && cb({ type: 'sync' })
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake) }
  },
}
