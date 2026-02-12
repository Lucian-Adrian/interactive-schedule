import type { Slot } from '@/lib/types'
import { slotToDisplayTimes } from '@/lib/time'

export function buildMessage(args: {
  lang: 'ro' | 'en' | 'ru'
  title: string
  configTimezone: string
  viewTimezone: string
  weekRangeLabel: string
  slots: Slot[]
}): string {
  const header =
    args.lang === 'ro'
      ? `Bună! Aș dori să rezerv o sesiune.\n\n${args.title}\n${args.weekRangeLabel}`
      : args.lang === 'ru'
        ? `Привет! Я хотел бы забронировать занятие.\n\n${args.title}\n${args.weekRangeLabel}`
        : `Hi! I would like to book a session.\n\n${args.title}\n${args.weekRangeLabel}`

  const list =
    args.slots.length === 0
      ? args.lang === 'ro'
        ? '- (nimic selectat)'
        : args.lang === 'ru'
          ? '- (ничего не выбрано)'
          : '- (nothing selected)'
      : args.slots
          .map((s) => {
            const d = slotToDisplayTimes(s, args.configTimezone, args.viewTimezone, args.lang)
            return `- ${d.dayLabel} ${d.range} — ${s.label}`
          })
          .join('\n')

  const tzLine =
    args.lang === 'ro'
      ? `\n\nFus orar: ${args.viewTimezone}`
      : args.lang === 'ru'
        ? `\n\nЧасовой пояс: ${args.viewTimezone}`
        : `\n\nTimezone: ${args.viewTimezone}`

  return `${header}\n\n${list}${tzLine}`
}
