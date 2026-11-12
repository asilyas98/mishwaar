// The 22 governorates of Yemen with the approximate centre of each capital city.
// `extra` holds other large towns, used when guessing a place's governorate.
// Used to jump the map and to scope OpenStreetMap updates. Coordinates are approximate.
export const GOVERNORATES = [
  { id: 'amanat-al-asimah', name: 'أمانة العاصمة', city: 'صنعاء', lat: 15.3694, lng: 44.191 },
  { id: 'sanaa', name: 'محافظة صنعاء', city: 'صنعاء', lat: 15.42, lng: 44.24, extra: [[15.2, 44.05], [15.55, 44.45]] },
  { id: 'aden', name: 'عدن', city: 'عدن', lat: 12.7855, lng: 45.0187 },
  { id: 'taiz', name: 'تعز', city: 'تعز', lat: 13.5795, lng: 44.0209 },
  { id: 'hodeidah', name: 'الحديدة', city: 'الحديدة', lat: 14.7978, lng: 42.9545 },
  { id: 'ibb', name: 'إب', city: 'إب', lat: 13.9667, lng: 44.1833 },
  { id: 'hadramawt', name: 'حضرموت', city: 'المكلا', lat: 14.5425, lng: 49.1242, extra: [[15.94, 48.79], [16.05, 49.0]] },
  { id: 'dhamar', name: 'ذمار', city: 'ذمار', lat: 14.5427, lng: 44.4051 },
  { id: 'marib', name: 'مأرب', city: 'مأرب', lat: 15.4627, lng: 45.3253 },
  { id: 'hajjah', name: 'حجة', city: 'حجة', lat: 15.6943, lng: 43.6058 },
  { id: 'saada', name: 'صعدة', city: 'صعدة', lat: 16.9402, lng: 43.7639 },
  { id: 'amran', name: 'عمران', city: 'عمران', lat: 15.6594, lng: 43.9439 },
  { id: 'al-bayda', name: 'البيضاء', city: 'البيضاء', lat: 13.9853, lng: 45.5727 },
  { id: 'lahij', name: 'لحج', city: 'الحوطة', lat: 13.0567, lng: 44.8819 },
  { id: 'abyan', name: 'أبين', city: 'زنجبار', lat: 13.1287, lng: 45.3807 },
  { id: 'shabwah', name: 'شبوة', city: 'عتق', lat: 14.5377, lng: 46.8319 },
  { id: 'al-mahrah', name: 'المهرة', city: 'الغيضة', lat: 16.2079, lng: 52.176 },
  { id: 'al-jawf', name: 'الجوف', city: 'الحزم', lat: 16.1642, lng: 44.7769 },
  { id: 'al-mahwit', name: 'المحويت', city: 'المحويت', lat: 15.47, lng: 43.5448 },
  { id: 'raymah', name: 'ريمة', city: 'الجبين', lat: 14.7036, lng: 43.6 },
  { id: 'ad-dali', name: 'الضالع', city: 'الضالع', lat: 13.6957, lng: 44.7314 },
  { id: 'socotra', name: 'أرخبيل سقطرى', city: 'حديبو', lat: 12.6519, lng: 54.0237 },
]

// Whole-country bounding box (south, west, north, east)
export const YEMEN_BBOX = [12.0, 41.8, 19.0, 54.6]
export const YEMEN_CENTER = [15.55, 47.5]
