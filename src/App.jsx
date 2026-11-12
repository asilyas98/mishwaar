import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import AccountScreen from './components/AccountScreen'
import TaxiPanel from './components/TaxiPanel'
import { StarsDisplay, StarsInput } from './components/Stars'
import { CATEGORIES } from './data/categories'
import { GOVERNORATES } from './data/governorates'
import { currentUser, onAuthChange } from './lib/auth'
import * as store from './lib/store'
import { distanceM, formatDistance, bearingLabel, getPosition, arNum } from './lib/geo'
import { saveArea } from './lib/offline'

const TAB_KEY = 'mishwaar:tab'
const TABS = [
  { id: 'bus', label: CATEGORIES.bus.tab },
  { id: 'moto', label: CATEGORIES.moto.tab },
  { id: 'taxi', label: 'التاكسي' },
]
const WELCOMED_KEY = 'mishwaar:welcomed'

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('ar-YE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'لم يُحدَّث بعد'

function placeName(p) {
  return p.name || `${CATEGORIES[p.category].kinds[p.kind]} بدون اسم`
}

function roadLength(points) {
  let m = 0
  for (let i = 1; i < points.length; i++) m += distanceM({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] })
  return m
}

export default function App() {
  const [tab, setTab] = useState(() => {
    if (location.hash === '#taxi') return 'taxi'
    try { return localStorage.getItem(TAB_KEY) || 'bus' } catch { return 'bus' }
  })
  const [user, setUser] = useState(null)
  const [showAccount, setShowAccount] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [osm, setOsm] = useState({ updatedAt: null, items: [] })
  const [community, setCommunity] = useState([])
  const [roads, setRoads] = useState([])
  const [roadDraft, setRoadDraft] = useState(null) // { points: [[lat, lng]], name } while drawing
  const [selectedRoadId, setSelectedRoadId] = useState(null)
  const [taxiMap, setTaxiMap] = useState({ markers: [] })
  const [ratings, setRatings] = useState({ summary: {}, mine: {} })
  const [online, setOnline] = useState(navigator.onLine)
  const [updating, setUpdating] = useState(false)
  const [pending, setPending] = useState(0)
  const [gov, setGov] = useState('all')
  const [query, setQuery] = useState('')
  const [userPos, setUserPos] = useState(null)
  const [locating, setLocating] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [flyTo, setFlyTo] = useState(null)
  const [addMode, setAddMode] = useState(false)
  const [draft, setDraft] = useState({ pin: null, name: '', kind: '' })
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(null)
  const mapRef = useRef(null)

  const say = useCallback((text) => {
    setToast(text)
    clearTimeout(say.t)
    say.t = setTimeout(() => setToast(null), 3500)
  }, [])

  // ----- boot: show cached data immediately, then refresh if online -----
  useEffect(() => {
    let alive = true
    ;(async () => {
      const u = await currentUser()
      if (!alive) return
      setUser(u)
      try {
        if (!u && !localStorage.getItem(WELCOMED_KEY)) setWelcome(true)
      } catch { /* storage blocked */ }
      setOsm(await store.loadOsm())
      setCommunity(await store.loadCommunity())
      setRoads(await store.loadRoads())
      setRatings(await store.loadRatings())
      setPending(await store.pendingCount())
      if (navigator.onLine) refresh(u, true)
    })()
    const off = onAuthChange(setUser)
    return () => { alive = false; off() }
  }, [])

  const refresh = useCallback(async (u = user, quiet = false) => {
    if (!navigator.onLine) { say('لا يوجد اتصال بالإنترنت. تعرض الخريطة آخر نسخة محفوظة.'); return }
    setUpdating(true)
    const results = await Promise.allSettled([
      store.refreshOsm().then(setOsm),
      store.sync().then(() => Promise.all([store.refreshCommunity().then(setCommunity), store.refreshRoads().then(setRoads)])),
      store.refreshRatings(u).then(setRatings),
    ])
    setPending(await store.pendingCount())
    setUpdating(false)
    if (!quiet) say(results[0].status === 'fulfilled' ? 'تم تحديث البيانات.' : 'تعذّر الوصول إلى خادم الخرائط. البيانات المحفوظة ما زالت تعمل.')
  }, [user, say])

  useEffect(() => {
    const up = () => { setOnline(true); refresh(user, true) }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [refresh, user])

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ } }, [tab])

  const cat = CATEGORIES[tab] || CATEGORIES.bus
  const isPlaceTab = tab !== 'taxi'

  // ----- the places for this tab, filtered and sorted by distance -----
  const allPlaces = useMemo(() => {
    const seen = new Set()
    return [...community, ...osm.items].filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
  }, [osm, community])

  const places = useMemo(() => {
    const q = query.trim()
    let list = allPlaces.filter((p) => p.category === tab)
    if (gov !== 'all') list = list.filter((p) => p.governorate === gov)
    if (q) list = list.filter((p) => placeName(p).includes(q) || (p.nameAlt || '').toLowerCase().includes(q.toLowerCase()))
    if (userPos) list = list.map((p) => ({ ...p, dist: distanceM(userPos, p) })).sort((a, b) => a.dist - b.dist)
    return list
  }, [allPlaces, tab, gov, query, userPos])

  const selected = useMemo(() => allPlaces.find((p) => p.id === selectedId), [allPlaces, selectedId])
  const selectedRoad = useMemo(() => roads.find((r) => r.id === selectedRoadId), [roads, selectedRoadId])

  function switchTab(t) {
    setTab(t); setSelectedId(null); setAddMode(false); setQuery(''); setSelectedRoadId(null)
  }

  // ----- what the map shows -----
  const markers = useMemo(() => {
    if (addMode) return draft.pin ? [{ id: null, ...draft.pin, kind: 'draft', selected: true }] : []
    if (!isPlaceTab) return taxiMap.markers
    return places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, kind: p.kind, selected: p.id === selectedId, pending: p.pending }))
  }, [addMode, draft.pin, isPlaceTab, taxiMap, places, selectedId])

  const lines = useMemo(() => {
    const list = roads.map((r) => ({ ...r, selected: r.id === selectedRoadId }))
    if (roadDraft) list.push({ id: 'draft', points: roadDraft.points, draft: true })
    return list
  }, [roads, selectedRoadId, roadDraft])

  function onMapClick(ll) {
    if (roadDraft) return setRoadDraft((d) => ({ ...d, points: [...d.points, [ll.lat, ll.lng]] }))
    if (addMode) return setDraft((d) => ({ ...d, pin: ll }))
    setSelectedRoadId(null)
    if (!isPlaceTab) return taxiMap.onMapClick?.(ll)
    setSelectedId(null)
  }

  function pickGov(id) {
    setGov(id)
    const g = GOVERNORATES.find((x) => x.id === id)
    if (g) setFlyTo({ lat: g.lat, lng: g.lng, zoom: 12, t: Date.now() })
  }

  async function locate() {
    setLocating(true)
    try {
      const pos = await getPosition()
      setUserPos(pos)
      setGov('all')
      setFlyTo({ ...pos, zoom: 15, t: Date.now() })
    } catch {
      say('تعذّر تحديد موقعك. اسمح للتطبيق باستخدام الموقع من إعدادات المتصفح، أو اختر محافظتك من القائمة.')
    } finally { setLocating(false) }
  }

  function select(id) {
    if (addMode || roadDraft) return
    setSelectedRoadId(null)
    setSelectedId(id)
    const p = allPlaces.find((x) => x.id === id)
    if (p) setFlyTo({ lat: p.lat, lng: p.lng, zoom: Math.max(mapRef.current?.getZoom() || 15, 15), t: Date.now() })
  }


  function requireAccount(action) {
    if (user) return true
    say(`سجّل الدخول أولًا حتى ت${action}.`)
    setShowAccount(true)
    return false
  }

  async function doRate(stars) {
    if (!requireAccount('قيّم')) return
    setRatings(await store.rate(selected.id, stars, user))
    setPending(await store.pendingCount())
    say(navigator.onLine || user.demo ? 'شكرًا، حُفظ تقييمك.' : 'حُفظ تقييمك وسيُرسل عند عودة الإنترنت.')
  }

  function startAdd() {
    if (!requireAccount('ضيف مكانًا')) return
    setSelectedId(null); setSelectedRoadId(null); setRoadDraft(null)
    setAddMode(true)
    setDraft({ pin: null, name: '', kind: cat.defaultKind })
  }

  async function saveDraft(e) {
    e.preventDefault()
    if (!draft.pin) return
    const p = await store.addPlace({ category: tab, kind: draft.kind, name: draft.name.trim(), lat: draft.pin.lat, lng: draft.pin.lng }, user)
    setCommunity(await store.loadCommunity())
    setPending(await store.pendingCount())
    setAddMode(false)
    setSelectedId(p.id)
    say(navigator.onLine ? 'أُضيف المكان. شكرًا لمساهمتك.' : 'أُضيف المكان على جهازك وسيُرسل عند عودة الإنترنت.')
  }

  // ----- roads people draw -----
  function startRoad() {
    if (!requireAccount('رسم طريقًا')) return
    setAddMode(false); setSelectedId(null); setSelectedRoadId(null)
    setRoadDraft({ points: [], name: '' })
    const m = mapRef.current
    if (m && m.getZoom() < 14) say('قرّب الخريطة على الطريق، ثم اضغط على نقاطه بالترتيب.')
  }

  async function saveRoad(e) {
    e.preventDefault()
    if (roadDraft.points.length < 2) return
    const r = await store.addRoad({ name: roadDraft.name.trim(), points: roadDraft.points.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) }, user)
    setRoads(await store.loadRoads())
    setPending(await store.pendingCount())
    setRoadDraft(null)
    setSelectedRoadId(r.id)
    say(navigator.onLine ? 'أُضيف الطريق إلى الخريطة. شكرًا لمساهمتك.' : 'حُفظ الطريق على جهازك وسيُرسل عند عودة الإنترنت.')
  }

  async function removeRoad(id) {
    setRoads(await store.deleteRoad(id, user))
    setPending(await store.pendingCount())
    setSelectedRoadId(null)
    say('حُذف الطريق.')
  }

  async function saveOffline() {
    const m = mapRef.current
    if (!m) return
    if (!navigator.onLine) { say('تحتاج إلى الإنترنت لحفظ المنطقة. بعد الحفظ تعمل دونه.'); return }
    if (m.getZoom() < 11) { say('قرّب الخريطة على مدينتك أو حيّك أولًا، ثم احفظ المنطقة.'); return }
    try {
      setSaving({ done: 0, total: 1 })
      const n = await saveArea(m, m.tileSource, (done, total) => setSaving({ done, total }))
      say(`حُفظت المنطقة (${arNum(n)} جزءًا من الخريطة). يمكنك فتحها دون إنترنت.`)
    } catch {
      say('المنطقة الظاهرة كبيرة جدًا. قرّب الخريطة أكثر ثم حاول مجددًا.')
    } finally { setSaving(null) }
  }

  const statusText = online
    ? updating ? 'جارٍ التحديث…' : `متصل · آخر تحديث ${fmtDate(osm.updatedAt)}`
    : `دون إنترنت · بيانات ${fmtDate(osm.updatedAt)}`

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">مشوار</span>
        </div>
        <button className={`status ${online ? 'on' : 'off'}`} onClick={() => refresh()} title="تحديث البيانات">
          <span className="dot" aria-hidden="true" />
          <span>{statusText}</span>
          {pending > 0 && <span className="badge">{arNum(pending)} بانتظار الإرسال</span>}
        </button>
        <button className="account-btn" onClick={() => setShowAccount(true)} aria-label="الحساب">
          {user ? user.name.slice(0, 1) : 'دخول'}
        </button>
      </header>

      <nav className="tabs" role="tablist" aria-label="الأقسام">
        {TABS.map((c) => (
          <button key={c.id} role="tab" aria-selected={tab === c.id} className={`tab tab-${c.id}`} onClick={() => switchTab(c.id)}>
            <span className={`tab-icon icon-${c.id}`} aria-hidden="true" />
            {c.label}
          </button>
        ))}
      </nav>

      <main className="body">
        <div className="map-wrap">
          <MapView
            markers={markers}
            lines={lines}
            onMarkerClick={(id) => (isPlaceTab ? select(id) : taxiMap.onMarkerClick?.(id))}
            onLineClick={(id) => { if (!roadDraft && !addMode) { setSelectedId(null); setSelectedRoadId(id) } }}
            userPos={userPos}
            flyTo={flyTo}
            crosshair={addMode || !!roadDraft || (!isPlaceTab && taxiMap.crosshair)}
            onMapClick={onMapClick}
            mapRef={mapRef}
          />
          <div className="map-actions">
            <button className="fab" onClick={locate} disabled={locating} aria-label="موقعي" title="موقعي">
              <span className="icon-locate" aria-hidden="true" />
            </button>
            {isPlaceTab && !addMode && !roadDraft && <button className="fab" onClick={startAdd}>+ أضف مكانًا</button>}
            {!addMode && !roadDraft && <button className="fab" onClick={startRoad}>ارسم طريقًا</button>}
            <button className="fab" onClick={saveOffline} disabled={!!saving}>
              {saving ? `جارٍ الحفظ ${arNum(Math.round((saving.done / saving.total) * 100))}٪` : 'احفظ للاستخدام دون إنترنت'}
            </button>
          </div>
          {addMode && <div className="map-hint">اضغط على الخريطة في المكان الصحيح بالضبط</div>}
          {roadDraft && <div className="map-hint">اضغط على نقاط الطريق بالترتيب من بدايته إلى نهايته</div>}
        </div>

        <aside className="panel">
          {roadDraft ? (
            <form className="add" onSubmit={saveRoad}>
              <h2>ارسم طريقًا</h2>
              <p className="muted">للطرق والممرات غير الموجودة على الخريطة. اضغط على الخريطة نقطةً بعد نقطة على طول الطريق.</p>
              <p className="count">{arNum(roadDraft.points.length)} نقطة{roadDraft.points.length > 1 ? ` · ${formatDistance(roadLength(roadDraft.points))}` : ''}</p>
              <div className="row">
                <button type="button" className="btn ghost" disabled={!roadDraft.points.length} onClick={() => setRoadDraft((d) => ({ ...d, points: d.points.slice(0, -1) }))}>تراجع عن آخر نقطة</button>
              </div>
              <label><span>اسم الطريق <span className="muted">(إن وُجد)</span></span>
                <input id="road-name" value={roadDraft.name} onChange={(e) => setRoadDraft({ ...roadDraft, name: e.target.value })} placeholder="مثال: طريق ترابي إلى قرية بيت الفقيه" />
              </label>
              <div className="row">
                <button type="button" className="btn ghost" onClick={() => setRoadDraft(null)}>إلغاء</button>
                <button className="btn primary" disabled={roadDraft.points.length < 2}>احفظ الطريق</button>
              </div>
            </form>
          ) : selectedRoad ? (
            <section className="detail">
              <button className="link back" onClick={() => setSelectedRoadId(null)}>→ رجوع</button>
              <p className="kind-label">طريق أضافه مستخدم</p>
              <h2>{selectedRoad.name || 'طريق بدون اسم'}</h2>
              <dl className="facts">
                <div><dt>الطول</dt><dd>{formatDistance(roadLength(selectedRoad.points))}</dd></div>
                <div><dt>المحافظة</dt><dd>{GOVERNORATES.find((g) => g.id === selectedRoad.governorate)?.name}</dd></div>
                <div><dt>أُضيف</dt><dd>{fmtDate(selectedRoad.created_at)}{selectedRoad.pending ? ' · بانتظار الإرسال' : ''}</dd></div>
              </dl>
              {user && selectedRoad.created_by === user.id && <button className="btn ghost" onClick={() => removeRoad(selectedRoad.id)}>احذف هذا الطريق</button>}
            </section>
          ) : !isPlaceTab ? (
            <TaxiPanel
              user={user}
              userPos={userPos}
              setUserPos={setUserPos}
              say={say}
              setFlyTo={setFlyTo}
              setMap={setTaxiMap}
              onNeedAccount={() => setShowAccount(true)}
            />
          ) : addMode ? (
            <form className="add" onSubmit={saveDraft}>
              <h2>{cat.addLabel}</h2>
              <p className="muted">{draft.pin ? 'يمكنك تحريك الدبوس بالضغط على مكان آخر.' : 'الخطوة ١: اضغط على الخريطة لتحديد المكان.'}</p>
              <label><span>الاسم <span className="muted">(إن وُجد)</span></span>
                <input id="add-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={tab === 'bus' ? 'مثال: فرزة باب اليمن' : 'مثال: ورشة الأمانة للدراجات'} />
              </label>
              <div className="row">
                <button type="button" className="btn ghost" onClick={() => setAddMode(false)}>إلغاء</button>
                <button className="btn primary" disabled={!draft.pin}>احفظ المكان</button>
              </div>
            </form>
          ) : selected ? (
            <PlaceDetail
              place={selected}
              userPos={userPos}
              summary={ratings.summary[selected.id]}
              mine={ratings.mine[selected.id]}
              online={online}
              onRate={doRate}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <>
              <div className="panel-head">
                <h1>{cat.title}</h1>
                <div className="filters">
                  <select id="gov" value={gov} onChange={(e) => pickGov(e.target.value)} aria-label="المحافظة">
                    <option value="all">كل المحافظات</option>
                    {GOVERNORATES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <input id="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم" aria-label="ابحث بالاسم" />
                </div>
                <p className="count muted">
                  {arNum(places.length)} {places.length === 1 ? 'مكان' : 'مكانًا'}
                  {userPos ? ' · مرتبة حسب المسافة منك' : ''}
                </p>
              </div>
              <ul className="list">
                {places.slice(0, 200).map((p) => (
                  <li key={p.id}>
                    <button className="item" onClick={() => select(p.id)}>
                      <span className={`kind-dot k-${p.kind}`} aria-hidden="true" />
                      <span className="item-main">
                        <span className="item-name">{placeName(p)}</span>
                        <span className="item-meta">
                          {CATEGORIES[p.category].kinds[p.kind]} · {GOVERNORATES.find((g) => g.id === p.governorate)?.name}
                          {p.source === 'community' && <span className="chip">أضافه مستخدم</span>}
                        </span>
                        <StarsDisplay summary={ratings.summary[p.id]} />
                      </span>
                      {p.dist != null && <span className="item-dist">{formatDistance(p.dist)}</span>}
                    </button>
                  </li>
                ))}
                {places.length === 0 && <li className="empty">{cat.empty}</li>}
              </ul>
              <button className="btn ghost add-btn" onClick={startAdd}>+ {cat.addLabel}</button>
              <p className="credit muted">بيانات الخرائط من OpenStreetMap ومن مساهمات مستخدمي مشوار.</p>
            </>
          )}
        </aside>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}

      {(showAccount || welcome) && (
        <AccountScreen
          user={user}
          welcome={welcome && !user}
          onUser={(u) => {
            setUser(u)
            if (u) store.refreshRatings(u).then(setRatings).catch(() => {})
            if (u?.role === 'driver') switchTab('taxi')
          }}
          onClose={() => {
            setShowAccount(false); setWelcome(false)
            try { localStorage.setItem(WELCOMED_KEY, '1') } catch { /* ignore */ }
          }}
        />
      )}
    </div>
  )
}

function PlaceDetail({ place, userPos, summary, mine, online, onRate, onBack }) {
  const c = CATEGORIES[place.category]
  const dist = userPos ? distanceM(userPos, place) : null
  const gov = GOVERNORATES.find((g) => g.id === place.governorate)
  return (
    <section className="detail" aria-labelledby="pl-name">
      <button className="link back" onClick={onBack}>→ رجوع إلى القائمة</button>
      <p className={`kind-label k-${place.kind}`}>{c.kinds[place.kind]}</p>
      <h2 id="pl-name">{placeName(place)}</h2>
      {place.nameAlt && <p className="muted" dir="ltr">{place.nameAlt}</p>}
      <dl className="facts">
        <div><dt>المحافظة</dt><dd>{gov?.name}</dd></div>
        {dist != null && <div><dt>المسافة</dt><dd>{formatDistance(dist)} باتجاه {bearingLabel(userPos, place)}</dd></div>}
        {place.hours && <div><dt>أوقات العمل</dt><dd dir="ltr">{place.hours}</dd></div>}
        {place.phone && <div><dt>الهاتف</dt><dd dir="ltr" className="select">{place.phone}</dd></div>}
        <div><dt>المصدر</dt><dd>{place.source === 'osm' ? 'OpenStreetMap' : place.pending ? 'أضفته أنت · بانتظار الإرسال' : 'أضافه مستخدم'}</dd></div>
      </dl>
      <div className="rating-box">
        <h3>التقييم</h3>
        <StarsDisplay summary={summary} />
        <StarsInput value={mine} onChange={onRate} />
      </div>
      {online ? (
        <a className="btn primary" href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">الاتجاهات في خرائط Google</a>
      ) : (
        <p className="note">دون إنترنت: اتبع اتجاه السهم والمسافة أعلاه، أو افتح الاتجاهات عند عودة الاتصال.</p>
      )}
    </section>
  )
}
