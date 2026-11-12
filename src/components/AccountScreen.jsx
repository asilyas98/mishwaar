import { useState } from 'react'
import { signIn, signUp, signOut } from '../lib/auth'
import { HAS_BACKEND } from '../lib/config'

export default function AccountScreen({ user, onUser, onClose, welcome }) {
  const [mode, setMode] = useState('signup')
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', role: 'rider' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const r = mode === 'signup' ? await signUp(form) : await signIn(form)
      if (r.needsConfirm) setMsg({ ok: true, text: 'أرسلنا رابط التأكيد إلى بريدك. افتحه ثم سجّل الدخول.' })
      else { onUser(r.user); onClose() }
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally { setBusy(false) }
  }

  if (user) {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <section className="account" onClick={(e) => e.stopPropagation()} aria-labelledby="acc-title">
          <h2 id="acc-title">حسابي</h2>
          <p className="acc-name">{user.name}</p>
          <p className="muted">{user.email}</p>
          <p className="muted">{user.role === 'driver' ? 'حساب سائق تاكسي' : 'حساب مستخدم'}{user.phone ? ` · ${user.phone}` : ''}</p>
          {user.demo && <p className="note">وضع تجريبي: حسابك وتقييماتك محفوظة على هذا الجهاز فقط.</p>}
          <div className="row">
            <button className="btn ghost" onClick={async () => { await signOut(); onUser(null); onClose() }}>تسجيل الخروج</button>
            <button className="btn" onClick={onClose}>رجوع</button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="sheet-backdrop" onClick={welcome ? undefined : onClose}>
      <section className="account" onClick={(e) => e.stopPropagation()} aria-labelledby="acc-title">
        {welcome && (
          <div className="welcome">
            <p className="brand-xl">مشوار</p>
            <p>مواقف الحافلات، محلات الدراجات النارية، وطلب تاكسي في كل محافظات اليمن.</p>
          </div>
        )}
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>حساب جديد</button>
          <button role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>تسجيل الدخول</button>
        </div>
        <form onSubmit={submit} className="form">
          {mode === 'signup' && (
            <>
              <fieldset className="seg-field">
                <legend>أنا</legend>
                <div className="seg">
                  <label className={form.role === 'rider' ? 'on' : ''}><input type="radio" name="role" value="rider" checked={form.role === 'rider'} onChange={upd('role')} />مستخدم / راكب</label>
                  <label className={form.role === 'driver' ? 'on' : ''}><input type="radio" name="role" value="driver" checked={form.role === 'driver'} onChange={upd('role')} />سائق تاكسي</label>
                </div>
              </fieldset>
              <label>الاسم<input id="acc-name" required value={form.name} onChange={upd('name')} autoComplete="name" /></label>
              <label><span>رقم الهاتف <span className="muted">{form.role === 'driver' ? '' : '(يظهر للسائق بعد قبول طلبك فقط)'}</span></span>
                <input id="acc-phone" type="tel" dir="ltr" required={form.role === 'driver'} value={form.phone} onChange={upd('phone')} autoComplete="tel" placeholder="7XX XXX XXX" />
              </label>
              {form.role === 'driver' && <p className="note">بعد إنشاء الحساب ستُكمل التسجيل في قسم التاكسي بصورة البطاقة الشخصية أو جواز السفر.</p>}
            </>
          )}
          <label>البريد الإلكتروني<input id="acc-email" type="email" dir="ltr" required value={form.email} onChange={upd('email')} autoComplete="email" /></label>
          {(HAS_BACKEND || mode === 'signup') && (
            <label>كلمة المرور<input id="acc-pass" type="password" dir="ltr" required={HAS_BACKEND} minLength={HAS_BACKEND ? 6 : 0} value={form.password} onChange={upd('password')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
          )}
          {msg && <p className={msg.ok ? 'note' : 'error'} role="alert">{msg.text}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'لحظة…' : mode === 'signup' ? 'أنشئ الحساب' : 'دخول'}</button>
        </form>
        {!HAS_BACKEND && <p className="note">وضع تجريبي: لم يُربط الخادم بعد، لذلك يُحفظ الحساب على هذا الجهاز فقط.</p>}
        {welcome && <button className="link" onClick={onClose}>تصفّح الخريطة أولًا</button>}
      </section>
    </div>
  )
}
