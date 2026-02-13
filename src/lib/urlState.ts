export function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Chisinau'
}

export function parsePrefsFromUrl(): { lang?: string; tz?: string; view?: string } {
  const u = new URL(window.location.href)
  const lang = u.searchParams.get('lang') ?? undefined
  const tz = u.searchParams.get('tz') ?? undefined
  const view = u.searchParams.get('view') ?? undefined
  return { lang, tz, view }
}

export function setPrefsToUrl(prefs: { lang: string; tz: string; view?: string }) {
  const u = new URL(window.location.href)
  u.searchParams.set('lang', prefs.lang)
  u.searchParams.set('tz', prefs.tz)
  if (prefs.view) u.searchParams.set('view', prefs.view)
  else u.searchParams.delete('view')
  window.history.replaceState(window.history.state, '', u.toString())
}
