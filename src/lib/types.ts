export enum SlotStatus {
  Available = 'Available',
  FewLeft = 'FewLeft',
  Full = 'Full',
  Occupied = 'Occupied',
  Hidden = 'Hidden',
}

export type ScheduleMode = 'weekly' | 'calendar'

export type Slot = {
  id: string
  profile_id: string
  slot_date: string | null
  day_of_week: number
  start_time: string
  end_time: string
  status: SlotStatus
  spots_total: number | null
  spots_available: number | null
  label: string
  note: string | null
  visibility: boolean | null
}

export type ScheduleConfig = {
  id: number
  title: string
  default_language: 'ro' | 'en' | 'ru' | null
  timezone: string | null
  show_full_slots?: boolean | null
}

export type ScheduleProfile = {
  id: string
  slug: string
  title: string
  description: string | null
  mode: ScheduleMode
  timezone: string | null
  default_language: 'ro' | 'en' | 'ru' | null
  is_public: boolean
}

export type SlotRequestStatus = 'pending' | 'approved' | 'rejected'

export type SlotRequest = {
  id: string
  profile_id: string
  profile_slug: string | null
  profile_title: string | null
  slot_id: string
  student_name: string | null
  student_contact: string | null
  student_class: string | null
  student_note: string | null
  status: SlotRequestStatus
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
  slot_date: string | null
  slot_day_of_week: number | null
  slot_start_time: string | null
  slot_end_time: string | null
  slot_label: string | null
}
