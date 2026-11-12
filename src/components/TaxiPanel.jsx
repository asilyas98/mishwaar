import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { taxi, LIVE_STATUSES } from '../lib/taxi'
import { distanceM, formatDistance, getPosition, arNum } from '../lib/geo'
import { enableNotifications, notify, permission, chime, subscribePush } from '../lib/notify'
import Chat from './Chat'
import DriverSignup from './DriverSignup'

const ARRIVE_RADIUS_M = 60
const POS_EVERY_MS = 12000
const SHOW_ENDED_FOR_MS = 15 * 60 * 1000

const STATUS_TEXT = {
  requested: 'نبحث عن سائق قريب…',
  accepted: 'السائق في الطريق إليك',
  arrived: 'وصل السائق',
  completed: 'انتهت الرحلة',
  cancelled: 'أُلغي الطلب',
}

const ago = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return min < 1 ? 'الآن' : `قبل ${arNum(min)} د`
}

export default function TaxiPanel({ user, userPos, setUserPos, say, setFlyTo, setMap, onNeedAccount }) {
  const [driver, setDriver] = useState(undefined) // undefined = loading, null = not registered
  const [ride, setRide] = useState(null)
  const [messages, setMessages] = useState([])
  const [open, setOpen] = useState([])
  const [pickup, setPickup] = useState(null)
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [dismissed, setDismissed] = useState(null)
  const [perm, setPerm] = useState(permission())
  const prev = useRef({ ride: null, openIds: null, msgIds: null })

  const isDriver = user?.role === 'driver'
  const live = ride && LIVE_STATUSES.includes(ride.status)
  const showRide = ride && ride.id !== dismissed && (live || Date.now() - Date.parse(ride.completedAt || ride.createdAt) < SHOW_ENDED_FOR_MS)
  const amDriverOfRide = ride && ride.driverId === user?.id
  const otherName = ride ? (amDriverOfRide ? ride.customerName : ride.driverName) : ''

  // ---------- load + live updates ----------
  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const [r, d] = await Promise.all([taxi.currentRide(user), isDriver ? taxi.getDriver(user) : Promise.resolve(null)])
      const msgs = r ? await taxi.messages(r.id) : []
      const reqs = isDriver && d?.online && !(r && LIVE_STATUSES.includes(r.status) && r.driverId === user.id) ? await taxi.openRequests(user) : []
      react(r, reqs, msgs)
      setRide(r); setDriver(d); setMessages(msgs); setOpen(reqs)
    } catch (e) {
      say(e.message)
    }
  }, [user, isDriver])

  // Turn changes into in-app messages and notifications.
  function react(r, reqs, msgs) {
    const p = prev.current
    const was = p.ride
    if (was && r && was.id === r.id && was.status !== r.status) {
      const iAmCustomer = r.customerId === user.id
      let t = null
      if (iAmCustomer && r.status === 'accepted') t = [`قبل ${r.driverName} طلبك`, `${r.driverCar || 'تاكسي'} · ${r.driverPlate || ''} في الطريق إليك.`]
      if (iAmCustomer && r.status === 'requested' && r.cancelledBy === 'driver') t = ['ألغى السائق', `${r.cancelReason || 'بدون سبب'}. نبحث لك عن سائق آخر.`]
      if (r.status === 'arrived') t = iAmCustomer ? ['وصل السائق', 'التقيتما. اتفقا على الأجرة وادفع نقدًا.'] : ['وصلت إلى الراكب', 'التقيتما. الدفع نقدًا عند اللقاء.']
      if (!iAmCustomer && r.status === 'cancelled') t = ['ألغى الراكب الطلب', r.cancelReason || 'بدون سبب']
      if (t) { say(`${t[0]}: ${t[1]}`); notify(t[0], t[1], { tag: `ride-${r.id}` }) }
    }
    // A driver lost the ride (they cancelled it themselves); nothing to announce.
    if (isDriver && p.openIds) {
      const fresh = reqs.filter((x) => !p.openIds.has(x.id))
      if (fresh.length) {
        const f = fresh[0]
        const dist = userPos ? ` على بعد ${formatDistance(distanceM(userPos, f.pickup))}` : ''
        chime()
        say(`طلب تاكسي جديد${dist}`)
        notify('طلب تاكسي جديد', `${f.customerName}${dist}${f.destination ? ` · إلى ${f.destination}` : ''}`, { tag: 'new-request' })
      }
    }
    if (p.msgIds && r && was?.id === r.id) {
      const incoming = msgs.filter((m) => !p.msgIds.has(m.id) && m.kind === 'text' && m.senderId !== user.id)
      if (incoming.length) notify(`رسالة من ${r.customerId === user.id ? r.driverName : r.customerName}`, incoming.at(-1).body, { tag: `chat-${r.id}` })
    }
    prev.current = { ride: r, openIds: new Set(reqs.map((x) => x.id)), msgIds: new Set(msgs.map((m) => m.id)) }
  }

  useEffect(() => {
    prev.current = { ride: null, openIds: null, msgIds: null }
    setDriver(undefined); setRide(null); setMessages([]); setOpen([])
    if (!user) return
    refresh()
    subscribePush(user).catch(() => {})
    const off = taxi.subscribe(user, () => refresh())
    const poll = setInterval(refresh, 20000) // safety net if a live update is missed
    return () => { off(); clearInterval(poll) }
  }, [user, refresh])

  // ---------- driver location: shared while online or on a ride ----------
  const tracking = isDriver && (driver?.online || (live && amDriverOfRide))
  const lastSent = useRef(0)
  useEffect(() => {
    if (!tracking || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }
        setUserPos(pos)
        const activeRide = live && amDriverOfRide ? ride : null
        if (Date.now() - lastSent.current > POS_EVERY_MS) {
          lastSent.current = Date.now()
          taxi.updateDriverPosition(user, pos, activeRide?.id).catch(() => {})
        }
        // They met: the driver is at the pickup point.
        if (activeRide?.status === 'accepted' && distanceM(pos, activeRide.pickup) < ARRIVE_RADIUS_M) {
          taxi.markArrived(user, activeRide.id).then(refresh).catch(() => {})
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tracking, live, amDriverOfRide, ride?.id, ride?.status])

  // ---------- what the map shows on this tab ----------
  const choosingPickup = user && !isDriver && !live
  useEffect(() => {
    const markers = []
    if (showRide && live) {
      markers.push({ id: null, ...ride.pickup, kind: 'pickup', big: true })
      if (ride.driverPos) markers.push({ id: null, ...ride.driverPos, kind: 'taxi', big: true })
    } else if (choosingPickup && pickup) {
      markers.push({ id: null, ...pickup, kind: 'pickup', big: true })
    } else if (isDriver) {
      open.forEach((r) => markers.push({ id: r.id, ...r.pickup, kind: 'pickup' }))
    }
    setMap({
      markers,
      crosshair: choosingPickup,
      onMapClick: choosingPickup ? (ll) => setPickup(ll) : null,
      onMarkerClick: null,
    })
  }, [ride, open, pickup, choosingPickup, showRide, live])

  useEffect(() => { if (!pickup && userPos && choosingPickup) setPickup({ lat: userPos.lat, lng: userPos.lng }) }, [userPos, choosingPickup])

  // ---------- actions ----------
  async function run(fn, okText) {
    setBusy(true)
    try { await fn(); if (okText) say(okText); await refresh() } catch (e) { say(e.message) } finally { setBusy(false) }
  }

  async function useMyLocation() {
    try {
      const pos = await getPosition()
      setUserPos(pos); setPickup({ lat: pos.lat, lng: pos.lng }); setFlyTo({ ...pos, zoom: 16, t: Date.now() })
    } catch { say('تعذّر تحديد موقعك. اضغط على الخريطة لتحديد مكانك يدويًا.') }
  }

  function request(e) {
    e.preventDefault()
    if (!pickup) { say('حدّد مكانك أولًا: استخدم موقعك أو اضغط على الخريطة.'); return }
    run(() => taxi.requestRide(user, { pickup, pickupNote: note.trim(), destination: destination.trim() }), 'أُرسل طلبك إلى السائقين القريبين.')
  }

  async function goOnline(on) {
    let pos = userPos
    if (on) {
      try { pos = await getPosition(); setUserPos(pos) } catch { say('شارك موقعك حتى ترى الطلبات القريبة وتصل إلى الركّاب.') }
      if (perm === 'default') setPerm(await enableNotifications(user))
    }
    run(() => taxi.setDriverOnline(user, on, pos), on ? 'أنت متاح الآن. ستصلك الطلبات الجديدة.' : 'لن تصلك طلبات جديدة.')
  }

  async function accept(r) {
    setBusy(true)
    try {
      const res = await taxi.acceptRide(user, r.id)
      if (res.ok) { say('قبلت الطلب. توجّه إلى الراكب.'); setFlyTo({ ...r.pickup, zoom: 16, t: Date.now() }) }
      else say('سبقك سائق آخر إلى هذا الطلب.')
      await refresh()
    } catch (e) { say(e.message) } finally { setBusy(false) }
  }

  function confirmCancel(e) {
    e.preventDefault()
    const needsReason = ride.status !== 'requested'
    if (needsReason && !reason.trim()) { say('اكتب سبب الإلغاء حتى يعرفه الطرف الآخر.'); return }
    run(() => taxi.cancelRide(user, ride.id, reason.trim()), amDriverOfRide ? 'ألغيت الرحلة وأُبلغ الراكب.' : 'أُلغي طلبك.')
    setCancelling(false); setReason('')
  }

  // ---------- render ----------
  if (!user) {
    return (
      <div className="taxi">
        <h1>التاكسي</h1>
        <p>اطلب تاكسيًا فيأتيك سائق مسجّل قريب منك، أو سجّل كسائق لتستقبل الطلبات. الدفع نقدًا عند اللقاء.</p>
        <button className="btn primary" onClick={onNeedAccount}>سجّل الدخول أو أنشئ حسابًا</button>
      </div>
    )
  }

  const notifPrompt = perm === 'default' && (
    <button className="btn ghost" onClick={async () => setPerm(await enableNotifications(user))}>فعّل الإشعارات حتى لا يفوتك شيء</button>
  )

  if (showRide) {
    const meet = ride.status === 'arrived'
    const distToPickup = ride.driverPos ? distanceM(ride.driverPos, ride.pickup) : null
    return (
      <div className="taxi">
        <div className={`ride-status s-${ride.status}`} role="status">
          <span className="pulse" aria-hidden="true" />
          <div>
            <p className="ride-state">{amDriverOfRide && ride.status === 'accepted' ? 'في الطريق إلى الراكب' : STATUS_TEXT[ride.status]}</p>
            <p className="muted">
              {ride.status === 'requested' && `أُرسل ${ago(ride.createdAt)} · يظهر للسائقين المتاحين`}
              {ride.status === 'accepted' && distToPickup != null && `السائق على بعد ${formatDistance(distToPickup)}`}
              {meet && 'التقيتما. اتفقا على الأجرة، والدفع نقدًا.'}
              {ride.status === 'cancelled' && (ride.cancelReason ? `السبب: ${ride.cancelReason}` : '')}
            </p>
          </div>
        </div>

        {ride.status === 'requested' && ride.cancelledBy === 'driver' && (
          <p className="note">ألغى السائق السابق: {ride.cancelReason || 'بدون سبب'}. طلبك متاح لسائقين آخرين.</p>
        )}

        {ride.driverId && (
          <dl className="facts">
            <div><dt>{amDriverOfRide ? 'الراكب' : 'السائق'}</dt><dd>{otherName}</dd></div>
            {!amDriverOfRide && ride.driverCar && <div><dt>السيارة</dt><dd>{ride.driverCar}</dd></div>}
            {!amDriverOfRide && ride.driverPlate && <div><dt>رقم اللوحة</dt><dd className="plate">{ride.driverPlate}</dd></div>}
            {(amDriverOfRide ? ride.customerPhone : ride.driverPhone) && (
              <div><dt>الهاتف</dt><dd dir="ltr" className="select">{amDriverOfRide ? ride.customerPhone : ride.driverPhone}</dd></div>
            )}
            {ride.destination && <div><dt>الوجهة</dt><dd>{ride.destination}</dd></div>}
            {ride.pickupNote && <div><dt>علامة المكان</dt><dd>{ride.pickupNote}</dd></div>}
          </dl>
        )}

        {live && amDriverOfRide && (
          <div className="row">
            <a className="btn ghost" href={`https://www.google.com/maps/dir/?api=1&destination=${ride.pickup.lat},${ride.pickup.lng}`} target="_blank" rel="noreferrer">الاتجاهات إلى الراكب</a>
            {ride.status === 'accepted' && <button className="btn primary" disabled={busy} onClick={() => run(() => taxi.markArrived(user, ride.id))}>وصلت إلى الراكب</button>}
          </div>
        )}
        {meet && <button className="btn primary" disabled={busy} onClick={() => run(() => taxi.completeRide(user, ride.id), 'انتهت الرحلة. شكرًا لاستخدامك مشوار.')}>انتهت الرحلة</button>}

        {ride.driverId && (live || messages.length > 0) && (
          <Chat user={user} messages={messages} otherName={otherName} disabled={!live} onSend={(body) => taxi.sendMessage(user, ride.id, body).then(refresh)} />
        )}

        {live && !meet && (cancelling ? (
          <form className="cancel-box" onSubmit={confirmCancel}>
            <label>{ride.status === 'requested' ? 'سبب الإلغاء (اختياري)' : `سبب الإلغاء (يصل إلى ${otherName})`}
              <textarea id="cancel-reason" rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={amDriverOfRide ? 'مثال: تعطّلت السيارة' : 'مثال: وجدت وسيلة أخرى'} />
            </label>
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setCancelling(false)}>تراجع</button>
              <button className="btn danger" disabled={busy}>{amDriverOfRide ? 'ألغِ الرحلة' : 'ألغِ الطلب'}</button>
            </div>
          </form>
        ) : (
          <button className="link danger-link" onClick={() => setCancelling(true)}>{amDriverOfRide ? 'إلغاء الرحلة' : 'إلغاء الطلب'}</button>
        ))}

        {!live && <button className="btn ghost" onClick={() => setDismissed(ride.id)}>{isDriver ? 'رجوع إلى الطلبات' : 'طلب جديد'}</button>}
        {notifPrompt}
      </div>
    )
  }

  // ---------- driver ----------
  if (isDriver) {
    if (driver === undefined) return <div className="taxi"><p className="muted">جارٍ التحميل…</p></div>
    if (!driver) return <DriverSignup user={user} say={say} onDone={(d) => { setDriver(d); refresh() }} />
    if (driver.status !== 'approved') {
      return (
        <div className="taxi">
          <h1>طلبك قيد المراجعة</h1>
          <p>نراجع وثيقتك ({driver.docType === 'passport' ? 'جواز السفر' : 'البطاقة الشخصية'}) وبيانات سيارتك. بعد الموافقة يمكنك استقبال الطلبات.</p>
          {driver.status === 'rejected' && <p className="error">لم تُقبل الوثيقة. تواصل مع إدارة مشوار.</p>}
        </div>
      )
    }
    return (
      <div className="taxi">
        <div className="driver-head">
          <h1>طلبات التاكسي</h1>
          <button className={`switch${driver.online ? ' on' : ''}`} role="switch" aria-checked={driver.online} disabled={busy} onClick={() => goOnline(!driver.online)}>
            <span className="knob" aria-hidden="true" />{driver.online ? 'متاح' : 'غير متاح'}
          </button>
        </div>
        {!driver.online ? (
          <p className="muted">فعّل «متاح» لتصلك طلبات الركّاب القريبين. سيُشارَك موقعك مع الراكب بعد قبول طلبه فقط.</p>
        ) : (
          <>
            <p className="count muted">{open.length ? `${arNum(open.length)} طلب بانتظار سائق · أول من يقبل يأخذ الطلب` : 'لا توجد طلبات الآن. سنُعلمك عند وصول طلب جديد.'}</p>
            <ul className="list">
              {open
                .map((r) => ({ ...r, dist: userPos ? distanceM(userPos, r.pickup) : null }))
                .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
                .map((r) => (
                  <li key={r.id} className="request">
                    <div className="item-main">
                      <span className="item-name">{r.customerName}</span>
                      <span className="item-meta">
                        {r.dist != null && <b>{formatDistance(r.dist)}</b>}
                        {r.destination && <span>إلى {r.destination}</span>}
                        <span>{ago(r.createdAt)}</span>
                      </span>
                      {r.pickupNote && <span className="item-meta">{r.pickupNote}</span>}
                    </div>
                    <button className="btn primary" disabled={busy} onClick={() => accept(r)}>اقبل</button>
                  </li>
                ))}
            </ul>
          </>
        )}
        {notifPrompt}
      </div>
    )
  }

  // ---------- rider: new request ----------
  return (
    <form className="taxi" onSubmit={request}>
      <h1>اطلب تاكسي</h1>
      <div className="pickup">
        <span className="muted">مكان الركوب</span>
        <p>{pickup ? (userPos && distanceM(userPos, pickup) < 30 ? 'موقعك الحالي' : 'المكان الذي حدّدته على الخريطة') : 'لم يُحدَّد بعد'}</p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={useMyLocation}>استخدم موقعي</button>
        </div>
        <p className="muted small">أو اضغط على الخريطة لتحديد مكان الركوب.</p>
      </div>
      <label><span>إلى أين؟ <span className="muted">(اختياري)</span></span>
        <input id="taxi-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="مثال: باب اليمن" />
      </label>
      <label><span>علامة تساعد السائق <span className="muted">(اختياري)</span></span>
        <input id="taxi-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: أمام البقالة، بوابة زرقاء" />
      </label>
      <p className="note">الدفع نقدًا عند اللقاء. تتفق على الأجرة مع السائق.</p>
      <button className="btn primary big" disabled={busy || !pickup}>{busy ? 'جارٍ الإرسال…' : 'اطلب تاكسي الآن'}</button>
      {notifPrompt}
    </form>
  )
}
