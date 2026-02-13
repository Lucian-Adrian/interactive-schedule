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
      ? `Bună! Aș dori să rezerv o sesiune.\n\n${args.title}\n${args.weekRangeLabel}\nIntervale preferate:`
      : args.lang === 'ru'
        ? `Здравствуйте! Хочу записаться на занятие.\n\n${args.title}\n${args.weekRangeLabel}\nПредпочтительные интервалы:`
        : `Hi! I'd like to book a session.\n\n${args.title}\n${args.weekRangeLabel}\nPreferred time options:`

  const list =
    args.slots.length === 0
      ? args.lang === 'ro'
        ? '1) (nimic selectat)'
        : args.lang === 'ru'
          ? '1) (ничего не выбрано)'
          : '1) (nothing selected)'
      : args.slots
          .map((s, index) => {
            const d = slotToDisplayTimes(s, args.configTimezone, args.viewTimezone, args.lang)
            return `${index + 1}) ${d.dayLabel}, ${d.range} — ${s.label}`
          })
          .join('\n')

  const tzLine =
    args.lang === 'ro'
      ? `\n\nFus orar: ${args.viewTimezone}`
      : args.lang === 'ru'
        ? `\n\nЧасовой пояс: ${args.viewTimezone}`
        : `\n\nTimezone: ${args.viewTimezone}`

  const footer =
    args.lang === 'ro'
      ? '\n\nMulțumesc! Confirmă-mi te rog ce interval rămâne disponibil.'
      : args.lang === 'ru'
        ? '\n\nСпасибо! Подтвердите, пожалуйста, какой интервал остается свободным.'
        : '\n\nThank you. Please confirm which interval is still available.'

  return `${header}\n\n${list}${tzLine}${footer}`
}
