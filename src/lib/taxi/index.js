import { supabase } from '../supabase'
import { localTaxi } from './local'
import { remoteTaxi } from './remote'

export const taxi = supabase ? remoteTaxi : localTaxi
export const LIVE_STATUSES = ['requested', 'accepted', 'arrived']
