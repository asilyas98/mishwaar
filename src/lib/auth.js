// Accounts. With Supabase configured: real email + password accounts.
// Without it (demo mode): accounts saved on this device only.
//
// Every account has a role: 'rider' (customer) or 'driver' (taxi driver).
import { supabase } from './supabase'

// ---------- demo mode ----------
// Accounts live in localStorage. The signed-in account is kept per browser tab
// (sessionStorage), so you can test a rider and a driver in two tabs side by side.
const ACCOUNTS_KEY = 'mishwaar:demo-accounts'
const CURRENT_KEY = 'mishwaar:demo-user'
const subs = new Set()

function readJSON(store, key, fallback) {
  try { return JSON.parse(store.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
function writeJSON(store, key, value) {
  try { value == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
}
function demoCurrent() {
  return readJSON(sessionStorage, CURRENT_KEY, null) || readJSON(localStorage, CURRENT_KEY, null)
}
function setDemoCurrent(u) {
  writeJSON(sessionStorage, CURRENT_KEY, u)
  writeJSON(localStorage, CURRENT_KEY, u)
  subs.forEach((cb) => cb(u))
}

// ---------- shared ----------
function fromSupabaseUser(u) {
  if (!u) return null
  const m = u.user_metadata || {}
  return { id: u.id, email: u.email, name: m.name || u.email.split('@')[0], phone: m.phone || '', role: m.role === 'driver' ? 'driver' : 'rider' }
}

export async function currentUser() {
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    return fromSupabaseUser(data.session?.user)
  }
  return demoCurrent()
}

export function onAuthChange(cb) {
  if (!supabase) {
    subs.add(cb)
    return () => subs.delete(cb)
  }
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(fromSupabaseUser(session?.user)))
  return () => data.subscription.unsubscribe()
}

const MESSAGES = {
  'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'User already registered': 'هذا البريد مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.',
  'Email not confirmed': 'لم يتم تأكيد البريد بعد. افتح الرسالة التي أرسلناها إليك ثم حاول مجددًا.',
}
const arError = (e) => new Error(MESSAGES[e.message] || 'تعذّر إكمال الطلب. تحقق من اتصالك بالإنترنت ثم حاول مجددًا.')

export async function signUp({ name, email, password, phone, role }) {
  role = role === 'driver' ? 'driver' : 'rider'
  if (supabase) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, phone, role } } })
    if (error) throw arError(error)
    if (!data.session) return { needsConfirm: true }
    return { user: fromSupabaseUser(data.user) }
  }
  const accounts = readJSON(localStorage, ACCOUNTS_KEY, {})
  const key = email.trim().toLowerCase()
  if (accounts[key]) throw new Error('هذا البريد مسجّل مسبقًا على هذا الجهاز. سجّل الدخول بدلًا من ذلك.')
  const user = { id: 'local-' + crypto.randomUUID(), name, email: key, phone, role, demo: true }
  accounts[key] = user
  writeJSON(localStorage, ACCOUNTS_KEY, accounts)
  setDemoCurrent(user)
  return { user }
}

export async function signIn({ email, password }) {
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw arError(error)
    return { user: fromSupabaseUser(data.user) }
  }
  const u = readJSON(localStorage, ACCOUNTS_KEY, {})[email.trim().toLowerCase()]
  if (!u) throw new Error('لا يوجد حساب بهذا البريد على هذا الجهاز. أنشئ حسابًا جديدًا.')
  setDemoCurrent(u)
  return { user: u }
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut()
  else setDemoCurrent(null)
}
