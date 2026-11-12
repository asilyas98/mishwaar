// Notifications. Two paths:
//  - Push (Supabase mode with VAPID keys): the server sends a push to the phone even when
//    the app is closed. See netlify/functions/notify.mjs.
//  - Local: when there is no push, the app shows a notification itself while it's open
//    in the background (e.g. another tab or the screen is off with the app still running).
import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
let pushActive = false

export const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator
export const permission = () => (canNotify() ? Notification.permission : 'unsupported')

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

// Call from a button tap (iPhone requires a tap before asking).
export async function enableNotifications(user) {
  if (!canNotify()) return 'unsupported'
  const p = await Notification.requestPermission()
  if (p === 'granted') await subscribePush(user).catch(() => {})
  return p
}

export async function subscribePush(user) {
  if (!supabase || !VAPID || !user || user.demo || permission() !== 'granted' || !('PushManager' in window)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }))
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' })
  pushActive = !error
  return pushActive
}

export async function notify(title, body, { tag, force } = {}) {
  try { navigator.vibrate?.([200, 100, 200]) } catch { /* not supported */ }
  if (pushActive && !force) return // the server already sent a push
  if (document.visibilityState === 'visible' && !force) return // the in-app message is enough
  if (permission() !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  reg.showNotification(title, { body, tag, renotify: true, dir: 'rtl', lang: 'ar', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/#taxi' } })
}

// Short chime for drivers when a new request comes in (only after the driver tapped something).
let ctx
export function chime() {
  try {
    ctx = ctx || new AudioContext()
    const t = ctx.currentTime
    ;[880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16)
      o.connect(g).connect(ctx.destination)
      o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.17)
    })
  } catch { /* audio blocked */ }
}
