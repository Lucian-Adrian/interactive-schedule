import { addDays, format, startOfWeek } from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { ScheduleMode, Slot } from '@/lib/types'

const WEEK_STARTS_ON = 1 as const

function getWeekStartInTz(tz: string): Date {
  const now = new Date()
  const zoned = toZonedTime(now, tz)
  return startOfWeek(zoned, { weekStartsOn: WEEK_STARTS_ON })
}

export function formatScheduleRange(mode: ScheduleMode, viewTz: string, lang: string): string {
  if (mode === 'calendar') {
    const now = new Date()
    const label = formatInTimeZone(now, viewTz, 'LLLL yyyy')
    return lang === 'ro'
      ? `Calendar: ${label}`
      : lang === 'ru'
        ? `Календарь: ${label}`
        : `Calendar: ${label}`
  }

  const weekStart = getWeekStartInTz(viewTz)
  const weekEnd = addDays(weekStart, 6)
  const pattern = 'd MMM'
  const a = formatInTimeZone(weekStart, viewTz, pattern)
  const b = formatInTimeZone(weekEnd, viewTz, pattern)
  return lang === 'ro' ? `Săptămâna: ${a}–${b}` : lang === 'ru' ? `Неделя: ${a}–${b}` : `Week: ${a}–${b}`
}

function slotDateInConfigTz(slot: Slot, configTz: string, viewTz: string): { start: Date; end: Date } {
  let yyyy: string
  let mm: string
  let dd: string

  if (slot.slot_date) {
    const date = new Date(`${slot.slot_date}T00:00:00`)
    yyyy = format(date, 'yyyy')
    mm = format(date, 'MM')
    dd = format(date, 'dd')
  } else {
    const weekStart = getWeekStartInTz(viewTz)
    const dayOffset = slot.day_of_week === 0 ? 6 : slot.day_of_week - 1
    const localDate = addDays(weekStart, dayOffset)
    yyyy = format(localDate, 'yyyy')
    mm = format(localDate, 'MM')
    dd = format(localDate, 'dd')
  }

  const startIso = `${yyyy}-${mm}-${dd}T${slot.start_time}:00`
  const endIso = `${yyyy}-${mm}-${dd}T${slot.end_time}:00`
  const startUtc = fromZonedTime(startIso, configTz)
  const endUtc = fromZonedTime(endIso, configTz)
  return { start: toZonedTime(startUtc, viewTz), end: toZonedTime(endUtc, viewTz) }
}

export function slotToDisplayTimes(
  slot: Slot,
  configTz: string,
  viewTz: string,
  lang: string,
): { dayLabel: string; range: string } {
  const { start, end } = slotDateInConfigTz(slot, configTz, viewTz)
  const day = slot.slot_date
    ? formatInTimeZone(start, viewTz, 'EEE, d MMM yyyy')
    : formatInTimeZone(start, viewTz, 'EEE, d MMM')
  const a = formatInTimeZone(start, viewTz, 'HH:mm')
  const b = formatInTimeZone(end, viewTz, 'HH:mm')
  return { dayLabel: day, range: `${a}–${b}` }
}
