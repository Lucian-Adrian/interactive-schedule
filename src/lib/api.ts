import { supabase } from '@/lib/supabase'
import type { ScheduleConfig, Slot, SlotRequest, SlotRequestStatus } from '@/lib/types'

const ADMIN_PWD_KEY = 'schedule-sync-admin-password'

function getStoredAdminPassword(): string | null {
  try {
    return localStorage.getItem(ADMIN_PWD_KEY)
  } catch {
    return null
  }
}

function setStoredAdminPassword(password: string | null) {
  try {
    if (password) localStorage.setItem(ADMIN_PWD_KEY, password)
    else localStorage.removeItem(ADMIN_PWD_KEY)
  } catch {
    // no-op
  }
}

function requireAdminPassword(): string {
  const password = getStoredAdminPassword()
  if (!password) throw new Error('Admin session not found. Login required.')
  return password
}

async function getConfig(): Promise<ScheduleConfig | null> {
  const { data, error } = await supabase.from('schedule_configs').select('*').eq('id', 1).single()
  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null
    throw error
  }
  return data as ScheduleConfig
}

async function getSlots(): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) throw error
  return (data ?? []) as Slot[]
}

async function saveSlot(slot: Slot): Promise<Slot> {
  const password = requireAdminPassword()
  const { data, error } = await supabase.rpc('admin_upsert_slot', {
    input_password: password,
    payload: slot,
  })
  if (error) throw error
  return data as Slot
}

async function deleteSlot(id: string): Promise<void> {
  const password = requireAdminPassword()
  const { error } = await supabase.rpc('admin_delete_slot', {
    input_password: password,
    p_id: id,
  })
  if (error) throw error
}

async function loginAdmin(password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_admin_password', {
    input_password: password,
  })
  if (error) throw error
  const ok = data === true
  if (ok) setStoredAdminPassword(password)
  return ok
}

async function restoreAdminSession(): Promise<boolean> {
  const password = getStoredAdminPassword()
  if (!password) return false
  try {
    const ok = await loginAdmin(password)
    if (!ok) setStoredAdminPassword(null)
    return ok
  } catch {
    setStoredAdminPassword(null)
    return false
  }
}

function logoutAdmin() {
  setStoredAdminPassword(null)
}

async function submitSlotRequest(input: {
  slotId: string
  studentName: string
  studentContact: string
  studentClass: string
  studentNote: string
}): Promise<SlotRequest> {
  const { data, error } = await supabase.rpc('submit_slot_request', {
    p_slot_id: input.slotId,
    p_student_name: input.studentName,
    p_student_contact: input.studentContact,
    p_student_class: input.studentClass,
    p_student_note: input.studentNote,
  })
  if (error) throw error
  return data as SlotRequest
}

async function getAdminSlotRequests(): Promise<SlotRequest[]> {
  const password = requireAdminPassword()
  const { data, error } = await supabase.rpc('admin_get_slot_requests', {
    input_password: password,
  })
  if (error) throw error
  return (data ?? []) as SlotRequest[]
}

async function reviewSlotRequest(input: {
  requestId: string
  status: Exclude<SlotRequestStatus, 'pending'>
  adminNote: string
}): Promise<SlotRequest> {
  const password = requireAdminPassword()
  const { data, error } = await supabase.rpc('admin_review_slot_request', {
    input_password: password,
    p_request_id: input.requestId,
    p_status: input.status,
    p_admin_note: input.adminNote,
  })
  if (error) throw error
  return data as SlotRequest
}

async function updateSlotRequest(input: {
  requestId: string
  studentName: string
  studentContact: string
  studentClass: string
  studentNote: string
}): Promise<SlotRequest> {
  const password = requireAdminPassword()
  const { data, error } = await supabase.rpc('admin_update_slot_request', {
    input_password: password,
    p_request_id: input.requestId,
    p_student_name: input.studentName,
    p_student_contact: input.studentContact,
    p_student_class: input.studentClass,
    p_student_note: input.studentNote,
  })
  if (error) throw error
  return data as SlotRequest
}

export const api = {
  getConfig,
  getSlots,
  saveSlot,
  deleteSlot,
  loginAdmin,
  restoreAdminSession,
  logoutAdmin,
  submitSlotRequest,
  getAdminSlotRequests,
  reviewSlotRequest,
  updateSlotRequest,
}
