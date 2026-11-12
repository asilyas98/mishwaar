// Sends push notifications for taxi events.
//
// Supabase calls this through two Database Webhooks (Database → Webhooks):
//   1. table rides,          events INSERT + UPDATE
//   2. table ride_messages,  events INSERT
// Both POST to https://<your-site>/.netlify/functions/notify with the HTTP header
//   x-webhook-secret: <WEBHOOK_SECRET>
//
// Netlify environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), WEBHOOK_SECRET
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const NEARBY_KM = 25
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)

function km(a, b) {
  const r = (d) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

async function nearbyDrivers(ride, exceptId) {
  const { data } = await db.from('drivers').select('id,lat,lng').eq('status', 'approved').eq('online', true)
  const p = { lat: ride.pickup_lat, lng: ride.pickup_lng }
  return (data || []).filter((d) => d.id !== exceptId && (d.lat == null || km(p, d) <= NEARBY_KM)).map((d) => d.id)
}

async function send(userIds, payload) {
  if (!userIds.length) return 0
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', userIds)
  let sent = 0
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 600, urgency: 'high' })
      sent++
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
    }
  }))
  return sent
}

async function plan({ type, table, record: r, old_record: o }) {
  const url = '/#taxi'
  if (table === 'ride_messages') {
    if (r.kind !== 'text') return []
    const { data: ride } = await db.from('rides').select('customer_id,driver_id,customer_name,driver_name').eq('id', r.ride_id).single()
    if (!ride) return []
    const toDriver = r.sender_id === ride.customer_id
    return [[[toDriver ? ride.driver_id : ride.customer_id].filter(Boolean), { title: `رسالة من ${toDriver ? ride.customer_name : ride.driver_name}`, body: r.body, tag: `chat-${r.ride_id}`, url }]]
  }
  if (table !== 'rides') return []
  const where = r.destination ? ` · إلى ${r.destination}` : ''
  if (type === 'INSERT' && r.status === 'requested') {
    return [[await nearbyDrivers(r), { title: 'طلب تاكسي جديد', body: `${r.customer_name}${where}`, tag: 'new-request', url }]]
  }
  if (type !== 'UPDATE' || !o || o.status === r.status) return []
  if (r.status === 'accepted') {
    return [[[r.customer_id], { title: `قبل ${r.driver_name} طلبك`, body: `${r.driver_car} · ${r.driver_plate} في الطريق إليك.`, tag: `ride-${r.id}`, url }]]
  }
  if (r.status === 'requested' && o.status === 'accepted') { // the driver backed out
    return [
      [[r.customer_id], { title: 'ألغى السائق', body: `${r.cancel_reason}. نبحث لك عن سائق آخر.`, tag: `ride-${r.id}`, url }],
      [await nearbyDrivers(r, o.driver_id), { title: 'طلب تاكسي جديد', body: `${r.customer_name}${where}`, tag: 'new-request', url }],
    ]
  }
  if (r.status === 'arrived') {
    return [
      [[r.customer_id], { title: 'وصل السائق', body: 'التقيتما. اتفقا على الأجرة وادفع نقدًا.', tag: `ride-${r.id}`, url }],
      [[r.driver_id], { title: 'وصلت إلى الراكب', body: 'التقيتما. الدفع نقدًا عند اللقاء.', tag: `ride-${r.id}`, url }],
    ]
  }
  if (r.status === 'cancelled' && r.cancelled_by === 'customer' && o.driver_id) {
    return [[[o.driver_id], { title: 'ألغى الراكب الطلب', body: r.cancel_reason, tag: `ride-${r.id}`, url }]]
  }
  return []
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!process.env.WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== process.env.WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const event = await req.json()
  let sent = 0
  for (const [ids, payload] of await plan(event)) sent += await send(ids, payload)
  return Response.json({ sent })
}
