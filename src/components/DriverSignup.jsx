import { useState } from 'react'
import { taxi } from '../lib/taxi'

// Taxi driver registration: car details plus a photo of a national ID card or passport.
export default function DriverSignup({ user, say, onDone }) {
  const [f, setF] = useState({ phone: user.phone || '', carModel: '', carColor: '', plate: '', docType: 'national_id', docNumber: '' })
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value })

  function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { say('الصورة أكبر من ٨ ميغابايت. اختر صورة أصغر.'); return }
    setFile(file)
    setPreview(URL.createObjectURL(file))
  }

  async function submit(e) {
    e.preventDefault()
    if (!file) { say('أضف صورة واضحة للوثيقة.'); return }
    setBusy(true)
    try {
      const d = await taxi.registerDriver(user, f, file)
      say(d.status === 'approved' ? 'تم تسجيلك كسائق. فعّل «متاح» لاستقبال الطلبات.' : 'استلمنا طلبك. سنراجع الوثيقة قريبًا.')
      onDone(d)
    } catch (err) {
      say(err.message)
    } finally { setBusy(false) }
  }

  return (
    <form className="taxi driver-form" onSubmit={submit}>
      <h1>سجّل كسائق تاكسي</h1>
      <p className="muted">نحتاج وثيقة رسمية للتحقق من هويتك قبل أن تستقبل الطلبات. لا تظهر الوثيقة للركّاب.</p>

      <fieldset className="seg-field">
        <legend>نوع الوثيقة</legend>
        <div className="seg">
          <label className={f.docType === 'national_id' ? 'on' : ''}><input type="radio" name="doc" value="national_id" checked={f.docType === 'national_id'} onChange={upd('docType')} />البطاقة الشخصية</label>
          <label className={f.docType === 'passport' ? 'on' : ''}><input type="radio" name="doc" value="passport" checked={f.docType === 'passport'} onChange={upd('docType')} />جواز السفر</label>
        </div>
      </fieldset>
      <label>{f.docType === 'passport' ? 'رقم جواز السفر' : 'رقم البطاقة الشخصية'}
        <input id="drv-doc" required dir="ltr" value={f.docNumber} onChange={upd('docNumber')} />
      </label>
      <label className="file-drop">
        <span>صورة الوثيقة</span>
        {preview ? <img src={preview} alt="صورة الوثيقة" /> : <span className="muted">التقط صورة واضحة للوجه الأمامي، أو اختر صورة من جهازك</span>}
        <input id="drv-file" type="file" accept="image/*" capture="environment" onChange={pick} />
      </label>

      <label>رقم الهاتف<input id="drv-phone" required type="tel" dir="ltr" value={f.phone} onChange={upd('phone')} placeholder="7XX XXX XXX" /></label>
      <div className="filters">
        <label>نوع السيارة<input id="drv-car" required value={f.carModel} onChange={upd('carModel')} placeholder="مثال: تويوتا كورولا" /></label>
        <label>اللون<input id="drv-color" value={f.carColor} onChange={upd('carColor')} placeholder="مثال: أصفر" /></label>
      </div>
      <label>رقم اللوحة<input id="drv-plate" required value={f.plate} onChange={upd('plate')} placeholder="مثال: أجرة ١٢٣٤٥ صنعاء" /></label>

      <label className="check"><input id="drv-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />أؤكد أن هذه المعلومات صحيحة وأن الوثيقة تخصّني.</label>
      <button className="btn primary big" disabled={busy || !agree}>{busy ? 'جارٍ الإرسال…' : 'أرسل طلب التسجيل'}</button>
    </form>
  )
}
