// The place tabs of the app and the kinds of place each one shows. (The taxi tab is separate.)
export const CATEGORIES = {
  bus: {
    id: 'bus',
    tab: 'الحافلات',
    title: 'الفرزات ومواقف الحافلات',
    addLabel: 'أضف فرزة أو موقفًا',
    empty: 'لا توجد فرزات أو مواقف حافلات معروفة هنا بعد. كن أول من يضيف واحدًا.',
    kinds: {
      bus_station: 'فرزة / محطة حافلات',
      bus_stop: 'موقف حافلات',
      bus_place: 'فرزة أو موقف حافلات',
    },
    // Places people add get this generic kind (no type to choose).
    defaultKind: 'bus_place',
    // OpenStreetMap tags that belong to this tab
    overpass: ['nwr["amenity"="bus_station"]', 'nwr["highway"="bus_stop"]', 'nwr["public_transport"="platform"]["bus"="yes"]'],
  },
  moto: {
    id: 'moto',
    tab: 'الدراجة النارية',
    title: 'محلات الدراجات النارية',
    addLabel: 'أضف محلًا',
    empty: 'لا توجد محلات دراجات نارية معروفة هنا بعد. كن أول من يضيف محلًا.',
    kinds: {
      motorcycle_shop: 'محل بيع دراجات نارية',
      motorcycle_repair: 'ورشة إصلاح دراجات نارية',
      motorcycle_parts: 'قطع غيار دراجات نارية',
      moto_place: 'محل دراجات نارية',
    },
    defaultKind: 'moto_place',
    overpass: ['nwr["shop"="motorcycle"]', 'nwr["shop"="motorcycle_repair"]', 'nwr["craft"="motorcycle_repair"]', 'nwr["shop"="motorcycle_parts"]'],
  },
}

export function kindFromOsmTags(t) {
  if (t.amenity === 'bus_station') return ['bus', 'bus_station']
  if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes')) return ['bus', 'bus_stop']
  if (t.shop === 'motorcycle_repair' || t.craft === 'motorcycle_repair') return ['moto', 'motorcycle_repair']
  if (t.shop === 'motorcycle_parts') return ['moto', 'motorcycle_parts']
  if (t.shop === 'motorcycle') return ['moto', 'motorcycle_shop']
  return [null, null]
}
