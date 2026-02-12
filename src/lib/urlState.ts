export function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Chisinau'
}

export function parsePrefsFromUrl(): { lang?: string; tz?: string } {
  const u = new URL(window.location.href)
  const lang = u.searchParams.get('lang') ?? undefined
  const tz = u.searchParams.get('tz') ?? undefined
  return { lang, tz }
}

export function setPrefsToUrl(prefs: { lang: string; tz: string }) {
  const u = new URL(window.location.href)
  u.searchParams.set('lang', prefs.lang)
  u.searchParams.set('tz', prefs.tz)
  window.history.replaceState(window.history.state, '', u.toString())
}
