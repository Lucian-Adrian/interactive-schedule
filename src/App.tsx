
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { api } from '@/lib/api'
import { buildMessage } from '@/lib/message'
import { formatScheduleRange, slotToDisplayTimes } from '@/lib/time'
import { getDefaultTimezone, parsePrefsFromUrl, setPrefsToUrl } from '@/lib/urlState'
import type { ScheduleConfig, ScheduleMode, ScheduleProfile, Slot, SlotRequest } from '@/lib/types'
import { SlotStatus } from '@/lib/types'

const LANGS = [
  { code: 'ro', name: 'Romana' },
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Russkiy' },
] as const

const DAY_LABELS: Record<'ro' | 'en' | 'ru', readonly string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ro: ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam', 'Dum'],
  ru: ['Pn', 'Vt', 'Sr', 'Cht', 'Pt', 'Sb', 'Vs'],
}

const LANG_STORAGE_KEY = 'schedule-sync-lang'
const VIEW_STORAGE_KEY = 'schedule-sync-view'

function getDayIndexForSlot(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1
}

function dayIndexToDow(dayIndex: number): number {
  return dayIndex === 6 ? 0 : dayIndex + 1
}

function isSelectable(status: SlotStatus): boolean {
  return status === SlotStatus.Available || status === SlotStatus.FewLeft
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function localeForLang(lang: 'ro' | 'en' | 'ru'): string {
  if (lang === 'ro') return 'ro-RO'
  if (lang === 'ru') return 'ru-RU'
  return 'en-US'
}

function toDateLabel(isoDate: string, lang: 'ro' | 'en' | 'ru', timezone: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  return new Intl.DateTimeFormat(localeForLang(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(date)
}

function sortSlots(mode: ScheduleMode, slots: Slot[]): Slot[] {
  const copy = slots.slice()
  if (mode === 'calendar') {
    copy.sort((a, b) => {
      const ad = a.slot_date ?? '9999-12-31'
      const bd = b.slot_date ?? '9999-12-31'
      if (ad !== bd) return ad.localeCompare(bd)
      return a.start_time.localeCompare(b.start_time)
    })
    return copy
  }

  copy.sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week
    return a.start_time.localeCompare(b.start_time)
  })
  return copy
}

export function App() {
  const { i18n, t } = useTranslation()

  const [config, setConfig] = useState<ScheduleConfig | null>(null)
  const [profiles, setProfiles] = useState<ScheduleProfile[]>([])
  const [activeViewSlug, setActiveViewSlug] = useState<string>('default')
  const [slots, setSlots] = useState<Slot[]>([])
  const [requests, setRequests] = useState<SlotRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [requestsLoading, setRequestsLoading] = useState(false)

  const [lang, setLang] = useState<'ro' | 'en' | 'ru'>('ro')
  const [timezone, setTimezone] = useState<string>(getDefaultTimezone())
  const [tzEditing, setTzEditing] = useState(false)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mobileDay, setMobileDay] = useState<number>(() => {
    const d = new Date().getDay()
    return d === 0 ? 6 : d - 1
  })

  const [adminLoginOpen, setAdminLoginOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminTab, setAdminTab] = useState<'schedule' | 'requests'>('schedule')
  const [editMode, setEditMode] = useState(false)
  const [authSending, setAuthSending] = useState(false)
  const [authInfo, setAuthInfo] = useState<string | null>(null)

  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [profileDraft, setProfileDraft] = useState<ScheduleProfile | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSlot, setEditorSlot] = useState<Slot | null>(null)
  const [calendarDraftDate, setCalendarDraftDate] = useState(() => new Date().toISOString().slice(0, 10))

  const [joinOpen, setJoinOpen] = useState(false)
  const [joinSlot, setJoinSlot] = useState<Slot | null>(null)

  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [requestQuery, setRequestQuery] = useState('')

  const shareCardRef = useRef<HTMLDivElement | null>(null)

  const activeProfile = useMemo(
    () => profiles.find((p) => p.slug === activeViewSlug) ?? profiles[0] ?? null,
    [profiles, activeViewSlug],
  )

  const configTimezone = activeProfile?.timezone ?? config?.timezone ?? timezone
  const mode = activeProfile?.mode ?? 'weekly'

  const title = 'DISPONIBILITATE'
  const subtitle = activeProfile?.description || t('subtitle')

  const allTimezones = useMemo(() => {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    const list = anyIntl.supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length) return list
    return ['Europe/Chisinau', 'Europe/Bucharest', 'Europe/London', 'America/New_York', 'Asia/Tokyo']
  }, [])

  const visibleSlots = useMemo(() => {
    const showFull = config?.show_full_slots ?? true
    const raw = editMode ? slots : slots.filter((s) => (s.visibility ?? true) === true)
    const withFull = showFull ? raw : raw.filter((s) => s.status !== SlotStatus.Full)
    return sortSlots(mode, withFull)
  }, [config?.show_full_slots, editMode, mode, slots])

  const selectedSlots = useMemo(() => {
    const byId = new Map(visibleSlots.map((s) => [s.id, s]))
    return selectedIds.map((id) => byId.get(id)).filter(Boolean) as Slot[]
  }, [selectedIds, visibleSlots])

  const rangeLabel = useMemo(() => formatScheduleRange(mode, timezone, lang), [mode, timezone, lang])

  const slotsByDay = useMemo(() => {
    const map = new Map<number, Slot[]>()
    for (const s of visibleSlots) {
      const idx = getDayIndexForSlot(s.day_of_week)
      const arr = map.get(idx) ?? []
      arr.push(s)
      map.set(idx, arr)
    }
    return map
  }, [visibleSlots])

  const calendarGroups = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of visibleSlots) {
      const key = s.slot_date ?? '__unscheduled__'
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items }))
  }, [visibleSlots])

  const filteredRequests = useMemo(() => {
    const q = requestQuery.trim().toLowerCase()
    return requests
      .filter((r) => (activeProfile ? r.profile_id === activeProfile.id : true))
      .filter((r) => (requestFilter === 'all' ? true : r.status === requestFilter))
      .filter((r) => {
        if (!q) return true
        const hay = [r.student_name, r.student_contact, r.student_class, r.student_note, r.slot_label]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
  }, [activeProfile, requestFilter, requestQuery, requests])

  const loadProfiles = useCallback(async () => {
    const list = isAdmin ? await api.getAdminProfiles() : await api.getPublicProfiles()
    setProfiles(list)
    return list
  }, [isAdmin])

  const loadSlots = useCallback(
    async (profileId: string) => {
      const list = isAdmin ? await api.getAdminSlotsForProfile(profileId) : await api.getPublicSlots(profileId)
      setSlots(list)
    },
    [isAdmin],
  )

  const loadRequests = useCallback(async () => {
    if (!isAdmin) return
    setRequestsLoading(true)
    try {
      const list = await api.getAdminSlotRequests()
      setRequests(list)
    } finally {
      setRequestsLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    const prefs = parsePrefsFromUrl()
    const storedLang = (localStorage.getItem(LANG_STORAGE_KEY) as 'ro' | 'en' | 'ru' | null) ?? null
    const initialLang =
      prefs.lang && (prefs.lang === 'ro' || prefs.lang === 'en' || prefs.lang === 'ru')
        ? prefs.lang
        : storedLang && (storedLang === 'ro' || storedLang === 'en' || storedLang === 'ru')
          ? storedLang
          : 'ro'
    setLang(initialLang)
    void i18n.changeLanguage(initialLang)

    const storedView = localStorage.getItem(VIEW_STORAGE_KEY)
    if (prefs.view) setActiveViewSlug(prefs.view)
    else if (storedView) setActiveViewSlug(storedView)

    if (prefs.tz) setTimezone(prefs.tz)
  }, [i18n])

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
    localStorage.setItem(VIEW_STORAGE_KEY, activeViewSlug)
    setPrefsToUrl({ lang, tz: timezone, view: activeProfile?.slug ?? activeViewSlug })
    void i18n.changeLanguage(lang)
  }, [activeProfile?.slug, activeViewSlug, i18n, lang, timezone])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const [cfg, loadedProfiles] = await Promise.all([api.getConfig(), loadProfiles()])
        if (!mounted) return
        setConfig(cfg)

        const targetSlug =
          parsePrefsFromUrl().view ?? localStorage.getItem(VIEW_STORAGE_KEY) ?? loadedProfiles[0]?.slug ?? 'default'
        const nextActive = loadedProfiles.find((p) => p.slug === targetSlug) ?? loadedProfiles[0] ?? null
        if (nextActive) {
          setActiveViewSlug(nextActive.slug)
          if (!parsePrefsFromUrl().tz && nextActive.timezone) setTimezone(nextActive.timezone)
          if (!parsePrefsFromUrl().lang && nextActive.default_language) setLang(nextActive.default_language)
          await loadSlots(nextActive.id)
        }
      } catch {
        // keep clean surface
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [loadProfiles, loadSlots])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const ok = await api.restoreAdminSession()
      if (!mounted) return
      setIsAdmin(ok)
      if (!ok) {
        setEditMode(false)
        setAdminTab('schedule')
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!activeProfile) return
    void loadSlots(activeProfile.id)
  }, [activeProfile, isAdmin, loadSlots])

  useEffect(() => {
    if (!isAdmin) {
      setRequests([])
      return
    }
    void loadRequests()
  }, [isAdmin, loadRequests])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setAdminLoginOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const openNewSlot = useCallback(
    (dayIndex?: number) => {
      if (!activeProfile) return
      const dow = typeof dayIndex === 'number' ? dayIndexToDow(dayIndex) : 1
      const slotDate = activeProfile.mode === 'calendar' ? calendarDraftDate : null
      const slot: Slot = {
        id: crypto.randomUUID(),
        profile_id: activeProfile.id,
        slot_date: slotDate,
        day_of_week: slotDate ? new Date(`${slotDate}T12:00:00`).getDay() : dow,
        start_time: '10:00',
        end_time: '11:00',
        status: SlotStatus.Available,
        spots_total: 1,
        spots_available: 1,
        label: t('newSlotLabel'),
        note: null,
        visibility: true,
      }
      setEditorSlot(slot)
      setEditorOpen(true)
    },
    [activeProfile, calendarDraftDate, t],
  )

  const onSlotClick = useCallback(
    (slot: Slot) => {
      if (editMode) {
        setEditorSlot(slot)
        setEditorOpen(true)
        return
      }
      if (!isSelectable(slot.status)) return
      setSelectedIds((prev) => {
        if (prev.includes(slot.id)) return prev.filter((x) => x !== slot.id)
        if (prev.length >= 3) return prev
        return [...prev, slot.id]
      })
    },
    [editMode],
  )

  const saveSlot = useCallback(
    async (next: Slot) => {
      if (!activeProfile) return
      const withProfile: Slot = {
        ...next,
        profile_id: activeProfile.id,
      }
      const saved = await api.saveSlot(withProfile)
      setSlots((prev) => {
        const idx = prev.findIndex((s) => s.id === saved.id)
        if (idx === -1) return sortSlots(mode, [...prev, saved])
        const copy = prev.slice()
        copy[idx] = saved
        return sortSlots(mode, copy)
      })
      setEditorOpen(false)
    },
    [activeProfile, mode],
  )

  const deleteSlot = useCallback(
    async (id: string) => {
      if (!window.confirm(t('confirmDelete'))) return
      await api.deleteSlot(id)
      setSlots((prev) => prev.filter((s) => s.id !== id))
      setEditorOpen(false)
    },
    [t],
  )

  const duplicateSlot = useCallback(
    async (slot: Slot) => {
      const copy: Slot = {
        ...slot,
        id: crypto.randomUUID(),
        label: `${slot.label} (Copy)`,
      }
      const saved = await api.saveSlot(copy)
      setSlots((prev) => sortSlots(mode, [...prev, saved]))
      setEditorSlot(saved)
      setEditorOpen(true)
    },
    [mode],
  )

  const loginWithPassword = useCallback(async () => {
    const password = adminPassword.trim()
    if (!password) return
    setAuthSending(true)
    setAuthInfo(null)
    try {
      const ok = await api.loginAdmin(password)
      if (!ok) {
        setAuthInfo(t('adminLoginFailed'))
        return
      }

      setIsAdmin(true)
      setEditMode(false)
      setAdminTab('schedule')
      setAdminLoginOpen(false)
      setAdminPassword('')
      setAuthInfo(t('adminLoginSuccess'))

      const nextProfiles = await api.getAdminProfiles()
      setProfiles(nextProfiles)
      const nextActive = nextProfiles.find((p) => p.slug === activeViewSlug) ?? nextProfiles[0] ?? null
      if (nextActive) {
        setActiveViewSlug(nextActive.slug)
        await loadSlots(nextActive.id)
      }
      await loadRequests()
    } catch {
      setAuthInfo(t('adminLoginFailed'))
    } finally {
      setAuthSending(false)
    }
  }, [activeViewSlug, adminPassword, loadRequests, loadSlots, t])

  const logoutAdmin = useCallback(async () => {
    api.logoutAdmin()
    setIsAdmin(false)
    setEditMode(false)
    setAdminTab('schedule')
    setRequests([])

    const nextProfiles = await api.getPublicProfiles()
    setProfiles(nextProfiles)
    const nextActive = nextProfiles.find((p) => p.slug === activeViewSlug) ?? nextProfiles[0] ?? null
    if (nextActive) {
      setActiveViewSlug(nextActive.slug)
      await loadSlots(nextActive.id)
    } else {
      setSlots([])
    }

    setAuthInfo(t('adminLoggedOut'))
  }, [activeViewSlug, loadSlots, t])

  const saveProfile = useCallback(async () => {
    if (!profileDraft) return
    const slug = slugify(profileDraft.slug || profileDraft.title)
    if (!slug) return
    const payload: ScheduleProfile = {
      ...profileDraft,
      slug,
      title: profileDraft.title.trim() || 'Disponibilitate',
      mode: profileDraft.mode === 'calendar' ? 'calendar' : 'weekly',
    }
    const saved = await api.saveProfile(payload)

    setProfiles((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id)
      if (idx === -1) return [...prev, saved]
      const copy = prev.slice()
      copy[idx] = saved
      return copy
    })
    setProfileEditorOpen(false)
    setProfileDraft(null)
    setActiveViewSlug(saved.slug)
    await loadSlots(saved.id)
  }, [loadSlots, profileDraft])

  const deleteActiveProfile = useCallback(async () => {
    if (!activeProfile) return
    if (!window.confirm(t('confirmDeleteProfile'))) return
    await api.deleteProfile(activeProfile.id)

    const nextProfiles = await api.getAdminProfiles()
    setProfiles(nextProfiles)
    const nextActive = nextProfiles[0] ?? null
    if (nextActive) {
      setActiveViewSlug(nextActive.slug)
      await loadSlots(nextActive.id)
    } else {
      setSlots([])
    }
  }, [activeProfile, loadSlots, t])

  const submitJoinRequest = useCallback(
    async (input: { slot: Slot; name: string; contact: string; classGrade: string; note: string }) => {
      await api.submitSlotRequest({
        slotId: input.slot.id,
        studentName: input.name,
        studentContact: input.contact,
        studentClass: input.classGrade,
        studentNote: input.note,
      })
      setJoinOpen(false)
      setJoinSlot(null)
      setAuthInfo(t('joinSubmitted'))
      window.setTimeout(() => setAuthInfo(null), 2400)
      if (isAdmin) void loadRequests()
    },
    [isAdmin, loadRequests, t],
  )

  const updateRequest = useCallback(
    async (input: {
      requestId: string
      studentName: string
      studentContact: string
      studentClass: string
      studentNote: string
    }) => {
      const updated = await api.updateSlotRequest(input)
      setRequests((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? {
                ...r,
                student_name: updated.student_name,
                student_contact: updated.student_contact,
                student_class: updated.student_class,
                student_note: updated.student_note,
              }
            : r,
        ),
      )
      setAuthInfo(t('requestUpdated'))
      window.setTimeout(() => setAuthInfo(null), 2000)
    },
    [t],
  )

  const reviewRequest = useCallback(
    async (requestId: string, status: 'approved' | 'rejected', adminNote: string) => {
      await api.reviewSlotRequest({ requestId, status, adminNote })
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status,
                admin_note: adminNote || null,
                reviewed_at: new Date().toISOString(),
              }
            : r,
        ),
      )
      setAuthInfo(status === 'approved' ? t('requestApproved') : t('requestRejected'))
      window.setTimeout(() => setAuthInfo(null), 2000)
    },
    [t],
  )

  const deleteRequest = useCallback(
    async (requestId: string) => {
      if (!window.confirm(t('confirmDeleteRequest'))) return
      await api.deleteSlotRequest(requestId)
      setRequests((prev) => prev.filter((r) => r.id !== requestId))
      setAuthInfo(t('requestDeleted'))
      window.setTimeout(() => setAuthInfo(null), 2000)
    },
    [t],
  )

  const copyMessage = useCallback(async () => {
    const msg = buildMessage({
      lang,
      title: activeProfile?.title ?? title,
      configTimezone,
      viewTimezone: timezone,
      weekRangeLabel: rangeLabel,
      slots: selectedSlots,
    })

    try {
      await navigator.clipboard.writeText(msg)
      setAuthInfo(t('copied'))
      window.setTimeout(() => setAuthInfo(null), 1800)
    } catch {
      window.prompt(t('copyFallback'), msg)
    }
  }, [activeProfile?.title, configTimezone, lang, rangeLabel, selectedSlots, t, timezone])

  const copyShareLink = useCallback(async () => {
    const url = new URL(window.location.href)
    if (activeProfile) url.searchParams.set('view', activeProfile.slug)
    url.searchParams.set('lang', lang)
    url.searchParams.set('tz', timezone)
    try {
      await navigator.clipboard.writeText(url.toString())
      setAuthInfo(t('linkCopied'))
      window.setTimeout(() => setAuthInfo(null), 1800)
    } catch {
      window.prompt(t('copyFallback'), url.toString())
    }
  }, [activeProfile, lang, t, timezone])

  const downloadImage = useCallback(async () => {
    if (!shareCardRef.current) return
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(shareCardRef.current, {
      cacheBust: true,
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: 'transparent',
    })
    const a = document.createElement('a')
    a.download = `disponibilitate-${activeProfile?.slug ?? 'view'}-${lang}.png`
    a.href = dataUrl
    a.click()
  }, [activeProfile?.slug, lang])

  const renderSlotCard = (slot: Slot) => {
    const selected = selectedIds.includes(slot.id)
    const display = slotToDisplayTimes(slot, configTimezone, timezone, lang)
    const disabled = !editMode && !isSelectable(slot.status)
    const spots =
      typeof slot.spots_total === 'number' && slot.spots_total > 0
        ? `${slot.spots_available ?? 0}/${slot.spots_total} ${t('spotsLeft')}`
        : null

    const pillClass =
      slot.status === SlotStatus.Available
        ? 'statusAvailable'
        : slot.status === SlotStatus.FewLeft
          ? 'statusFew'
          : 'statusFull'

    return (
      <button
        key={slot.id}
        className={clsx('slotCard', selected && 'slotCardSelected')}
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => onSlotClick(slot)}
      >
        <div className="slotTop">
          <div className={clsx('statusPill', pillClass)}>{t(slot.status)}</div>
          {selected ? <div className="slotSelectedMark">+</div> : null}
        </div>

        <div className="slotLabel">{display.range}</div>
        <div className="slotMeta">{display.dayLabel}</div>
        <div className="slotMeta">{slot.label}</div>
        {spots ? <div className="slotMeta">{spots}</div> : null}
        {slot.note ? <div className="slotMeta">{slot.note}</div> : null}

        {!editMode && isSelectable(slot.status) ? (
          <div className="slotJoinRow">
            <button
              className={clsx('btn', 'btnPrimary')}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setJoinSlot(slot)
                setJoinOpen(true)
              }}
            >
              {t('joinSlot')}
            </button>
          </div>
        ) : null}
      </button>
    )
  }

  const dayLabels = DAY_LABELS[lang]
  return (
    <div className="appShell">
      <div className="bgMesh" aria-hidden />

      <header className="headerGlass">
        <div className="headerInner">
          <div className="brandColumn">
            <h1 className="title">{title}</h1>
            <p className="subtitle">{subtitle}</p>
            {activeProfile ? <div className="activeViewLabel">/{activeProfile.slug}</div> : null}
          </div>

          <div className="toolbarCluster">
            <div className="pill glassPill">
              <span>{t('view')}</span>
              <select
                value={activeProfile?.slug ?? ''}
                onChange={(e) => setActiveViewSlug(e.target.value)}
                aria-label={t('view')}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.title} / {p.slug}
                  </option>
                ))}
              </select>
            </div>

            <button className="btn" type="button" onClick={() => void copyShareLink()}>
              {t('copyViewLink')}
            </button>

            {isAdmin ? (
              <button className="btn" type="button" onClick={() => setProfileEditorOpen(true)}>
                {t('manageViews')}
              </button>
            ) : null}

            {isAdmin ? (
              <div className="viewTabs" role="tablist" aria-label={t('adminAccess')}>
                <button
                  type="button"
                  role="tab"
                  className={clsx('viewTab', adminTab === 'schedule' && 'viewTabActive')}
                  aria-selected={adminTab === 'schedule'}
                  onClick={() => setAdminTab('schedule')}
                >
                  {t('scheduleTab')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={clsx('viewTab', adminTab === 'requests' && 'viewTabActive')}
                  aria-selected={adminTab === 'requests'}
                  onClick={() => setAdminTab('requests')}
                >
                  {t('requestsTab')}
                </button>
              </div>
            ) : null}

            {isAdmin ? (
              <button className="btn" type="button" onClick={() => setEditMode((v) => !v)}>
                {editMode ? t('viewPublic') : t('editMode')}
              </button>
            ) : null}

            {isAdmin ? (
              <button className="btn" type="button" onClick={() => void logoutAdmin()}>
                {t('logoutAdmin')}
              </button>
            ) : null}

            <div className="pill glassPill">
              <span>{t('language')}</span>
              <select value={lang} onChange={(e) => setLang(e.target.value as 'ro' | 'en' | 'ru')}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pill glassPill tzPill">
              <span>{t('timesShownIn')}</span>
              {!tzEditing ? (
                <button className="pillLink" type="button" onClick={() => setTzEditing(true)}>
                  {timezone}
                </button>
              ) : (
                <>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {allTimezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                  <button className="pillLink" type="button" onClick={() => setTzEditing(false)}>
                    {t('done')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="headerMetaRow">
          <div className="metaBadge">{rangeLabel}</div>
          {authInfo ? <div className="metaInfo">{authInfo}</div> : null}
          <button
            className={clsx('secretAdminTrigger', adminLoginOpen && 'secretAdminTriggerOpen')}
            type="button"
            onClick={() => setAdminLoginOpen((open) => !open)}
            aria-label={adminLoginOpen ? t('adminClose') : t('adminOpen')}
            title={adminLoginOpen ? t('adminClose') : t('adminOpen')}
          />
        </div>
      </header>

      <main className="container">
        {loading ? (
          <section className="surfaceCard centered">{t('loading')}</section>
        ) : !activeProfile ? (
          <section className="surfaceCard centered">{t('noViews')}</section>
        ) : (
          <>
            {isAdmin && adminTab === 'requests' ? (
              <AdminRequestsPanel
                timezone={timezone}
                lang={lang}
                requests={filteredRequests}
                loading={requestsLoading}
                query={requestQuery}
                filter={requestFilter}
                onQueryChange={setRequestQuery}
                onFilterChange={setRequestFilter}
                onReview={reviewRequest}
                onUpdate={updateRequest}
                onDelete={deleteRequest}
              />
            ) : (
              <section className="surfaceCard">
                <div className="scheduleHeader">
                  <div>
                    <h2 className="sectionTitle">{activeProfile.title}</h2>
                    <p className="sectionSub">{activeProfile.mode === 'calendar' ? t('calendarMode') : t('recurringMode')}</p>
                  </div>

                  <div className="sectionActions">
                    {editMode && activeProfile.mode === 'calendar' ? (
                      <>
                        <input
                          className="dateInput"
                          type="date"
                          value={calendarDraftDate}
                          onChange={(e) => setCalendarDraftDate(e.target.value)}
                        />
                        <button className="btn" type="button" onClick={() => openNewSlot()}>
                          {t('addDateSlot')}
                        </button>
                      </>
                    ) : null}

                    <button className="btn" type="button" onClick={() => void copyShareLink()}>
                      {t('share')}
                    </button>
                  </div>
                </div>

                {activeProfile.mode === 'weekly' ? (
                  <>
                    <div className="scheduleGrid desktopGrid" role="table" aria-label={t('schedule')}>
                      {dayLabels.map((label, dayIndex) => {
                        const daySlots = slotsByDay.get(dayIndex) ?? []
                        return (
                          <div key={label} className="dayCol" role="rowgroup">
                            <div className="dayHeader" role="row">
                              <span>{label}</span>
                              {editMode ? (
                                <button className="tinyAdd" type="button" onClick={() => openNewSlot(dayIndex)}>
                                  {t('add')}
                                </button>
                              ) : (
                                <small>{daySlots.length}</small>
                              )}
                            </div>

                            {daySlots.length === 0 ? <div className="emptyDay">{t('noOpeningsDay')}</div> : daySlots.map(renderSlotCard)}
                          </div>
                        )
                      })}
                    </div>

                    <div className="mobileOnly">
                      <div className="dayTabs" role="tablist" aria-label={t('days')}>
                        {dayLabels.map((label, index) => (
                          <button
                            key={label}
                            type="button"
                            className={clsx('tab', mobileDay === index && 'tabActive')}
                            aria-selected={mobileDay === index}
                            onClick={() => setMobileDay(index)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="mobileList">
                        {(slotsByDay.get(mobileDay) ?? []).length ? (
                          (slotsByDay.get(mobileDay) ?? []).map(renderSlotCard)
                        ) : (
                          <div className="emptyDay">{t('noOpeningsDay')}</div>
                        )}
                        {editMode ? (
                          <button className="btn mobileAdd" type="button" onClick={() => openNewSlot(mobileDay)}>
                            {t('add')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="calendarList">
                    {calendarGroups.length === 0 ? <div className="emptyDay">{t('noOpenings')}</div> : null}
                    {calendarGroups.map((group) => (
                      <section key={group.date} className="calendarSection">
                        <div className="calendarSectionHeader">
                          <h3>{group.date === '__unscheduled__' ? t('unscheduled') : toDateLabel(group.date, lang, timezone)}</h3>
                        </div>
                        <div className="calendarCards">{group.items.map(renderSlotCard)}</div>
                      </section>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {selectedSlots.length > 0 && !editMode ? (
        <div className="selectionBarWrap">
          <div className="selectionBar">
            <div className="selectionLeft">
              <div className="countBubble">{selectedSlots.length}</div>
              <div>
                <div className="selectionTitle">{t('selected', { count: selectedSlots.length })}</div>
                <button className="clearBtn" type="button" onClick={() => setSelectedIds([])}>
                  {t('clearAll')}
                </button>
              </div>
            </div>
            <div className="actions">
              <button className="btn" type="button" onClick={() => void copyMessage()}>
                {t('copyMessage')}
              </button>
              <button className={clsx('btn', 'btnPrimary')} type="button" onClick={() => void downloadImage()}>
                {t('downloadImage')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="shareCard" ref={shareCardRef} aria-hidden>
        <h3>{activeProfile?.title ?? title}</h3>
        <p>{rangeLabel}</p>
        <div>
          {selectedSlots.map((s) => {
            const d = slotToDisplayTimes(s, configTimezone, timezone, lang)
            return (
              <div key={s.id} className="shareLine">
                <span>{d.dayLabel}</span>
                <b>{d.range}</b>
              </div>
            )
          })}
        </div>
      </div>

      {joinOpen && joinSlot ? (
        <JoinSlotModal
          slot={joinSlot}
          timezone={timezone}
          configTimezone={configTimezone}
          lang={lang}
          onClose={() => {
            setJoinOpen(false)
            setJoinSlot(null)
          }}
          onSubmit={submitJoinRequest}
        />
      ) : null}

      {!isAdmin && adminLoginOpen ? (
        <AdminLoginModal
          adminPassword={adminPassword}
          authSending={authSending}
          onChangePassword={setAdminPassword}
          onClose={() => setAdminLoginOpen(false)}
          onSubmit={loginWithPassword}
        />
      ) : null}

      {editMode && editorOpen && editorSlot ? (
        <SlotEditor
          slot={editorSlot}
          mode={mode}
          timezone={configTimezone}
          onClose={() => setEditorOpen(false)}
          onSave={saveSlot}
          onDelete={deleteSlot}
          onDuplicate={duplicateSlot}
        />
      ) : null}

      {isAdmin && profileEditorOpen ? (
        <ProfileEditorModal
          profiles={profiles}
          activeProfileId={activeProfile?.id ?? null}
          draft={profileDraft}
          onPick={(profile) => setProfileDraft({ ...profile })}
          onNew={() => {
            const slug = `view-${Math.random().toString(36).slice(2, 8)}`
            setProfileDraft({
              id: crypto.randomUUID(),
              slug,
              title: 'Disponibilitate',
              description: null,
              mode: 'weekly',
              timezone: configTimezone,
              default_language: lang,
              is_public: true,
            })
          }}
          onClose={() => {
            setProfileEditorOpen(false)
            setProfileDraft(null)
          }}
          onDeleteActive={() => void deleteActiveProfile()}
          onSave={() => void saveProfile()}
          onDraftChange={setProfileDraft}
        />
      ) : null}
    </div>
  )
}
function AdminLoginModal(props: {
  adminPassword: string
  authSending: boolean
  onChangePassword: (value: string) => void
  onSubmit: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modalCard">
        <div className="modalTop">
          <h3>{t('adminAccess')}</h3>
          <button className="pillLink" type="button" onClick={props.onClose}>
            {t('close')}
          </button>
        </div>

        <form
          className="modalForm"
          onSubmit={(e) => {
            e.preventDefault()
            void props.onSubmit()
          }}
        >
          <p className="modalHint">{t('adminHint')}</p>
          <p className="modalHint">{t('adminShortcut')}</p>
          <input
            value={props.adminPassword}
            onChange={(e) => props.onChangePassword(e.target.value)}
            placeholder={t('password')}
            type="password"
            autoComplete="current-password"
            className="modalInput"
          />
          <div className="actions end">
            <button className="btn" type="button" onClick={props.onClose}>
              {t('cancel')}
            </button>
            <button className={clsx('btn', 'btnPrimary')} type="submit" disabled={props.authSending || !props.adminPassword.trim()}>
              {props.authSending ? t('sending') : t('login')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function JoinSlotModal(props: {
  slot: Slot
  timezone: string
  configTimezone: string
  lang: 'ro' | 'en' | 'ru'
  onClose: () => void
  onSubmit: (input: { slot: Slot; name: string; contact: string; classGrade: string; note: string }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [classGrade, setClassGrade] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const display = slotToDisplayTimes(props.slot, props.configTimezone, props.timezone, props.lang)

  const submit = async () => {
    if (!name.trim() || !contact.trim() || !classGrade.trim()) return
    setSending(true)
    try {
      await props.onSubmit({
        slot: props.slot,
        name: name.trim(),
        contact: contact.trim(),
        classGrade: classGrade.trim(),
        note: note.trim(),
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modalCard">
        <div className="modalTop">
          <h3>{t('joinSlot')}</h3>
          <button className="pillLink" type="button" onClick={props.onClose}>
            {t('close')}
          </button>
        </div>

        <form
          className="modalForm"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="slotMeta">{display.dayLabel} · {display.range}</div>
          <div className="slotMeta">{props.slot.label}</div>

          <input className="modalInput" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('yourName')} required />
          <input className="modalInput" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('yourContact')} required />
          <input className="modalInput" value={classGrade} onChange={(e) => setClassGrade(e.target.value)} placeholder={t('classGrade')} required />
          <textarea className="modalInput" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('yourMessage')} rows={4} />

          <div className="privacyNote">{t('privacyNote')}</div>

          <div className="actions end">
            <button className="btn" type="button" onClick={props.onClose}>
              {t('cancel')}
            </button>
            <button
              className={clsx('btn', 'btnPrimary')}
              type="submit"
              disabled={sending || !name.trim() || !contact.trim() || !classGrade.trim()}
            >
              {sending ? t('sending') : t('submitJoin')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SlotEditor(props: {
  slot: Slot
  mode: ScheduleMode
  timezone: string
  onClose: () => void
  onSave: (slot: Slot) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDuplicate: (slot: Slot) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Slot>(() => structuredClone(props.slot))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(structuredClone(props.slot))
  }, [props.slot])

  const save = async () => {
    setSaving(true)
    try {
      const next = { ...draft }
      if (props.mode === 'calendar' && draft.slot_date) {
        next.day_of_week = new Date(`${draft.slot_date}T12:00:00`).getDay()
      }
      await props.onSave(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modalCard wide">
        <div className="modalTop">
          <h3>{t('editSlot')}</h3>
          <button className="pillLink" type="button" onClick={props.onClose}>
            {t('close')}
          </button>
        </div>

        <div className="editorGrid">
          {props.mode === 'calendar' ? (
            <label className="field">
              <span>{t('date')}</span>
              <input
                type="date"
                className="modalInput"
                value={draft.slot_date ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, slot_date: e.target.value || null }))}
              />
            </label>
          ) : (
            <label className="field">
              <span>{t('day')}</span>
              <select
                className="modalInput"
                value={getDayIndexForSlot(draft.day_of_week)}
                onChange={(e) => setDraft((d) => ({ ...d, day_of_week: dayIndexToDow(Number(e.target.value)) }))}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <option key={i} value={i}>{i + 1}</option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>{t('start')}</span>
            <input
              type="time"
              className="modalInput"
              value={draft.start_time}
              onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>{t('end')}</span>
            <input
              type="time"
              className="modalInput"
              value={draft.end_time}
              onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))}
            />
          </label>

          <label className="field wideField">
            <span>{t('label')}</span>
            <input
              className="modalInput"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>{t('status')}</span>
            <select
              className="modalInput"
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as SlotStatus }))}
            >
              {Object.values(SlotStatus).map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('visible')}</span>
            <select
              className="modalInput"
              value={(draft.visibility ?? true) ? '1' : '0'}
              onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value === '1' }))}
            >
              <option value="1">{t('yes')}</option>
              <option value="0">{t('no')}</option>
            </select>
          </label>

          <label className="field">
            <span>{t('spotsAvailable')}</span>
            <input
              className="modalInput"
              type="number"
              value={draft.spots_available ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, spots_available: Number.parseInt(e.target.value || '0', 10) }))}
            />
          </label>

          <label className="field">
            <span>{t('spotsTotal')}</span>
            <input
              className="modalInput"
              type="number"
              value={draft.spots_total ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, spots_total: Number.parseInt(e.target.value || '0', 10) }))}
            />
          </label>

          <label className="field wideField">
            <span>{t('note')}</span>
            <textarea
              className="modalInput"
              rows={3}
              value={draft.note ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value || null }))}
            />
          </label>
        </div>

        <div className="actions between">
          <div className="actions">
            <button className="btn" type="button" onClick={() => void props.onDuplicate(draft)}>
              {t('duplicate')}
            </button>
            <button className="btn" type="button" onClick={() => void props.onDelete(draft.id)}>
              {t('delete')}
            </button>
          </div>

          <button className={clsx('btn', 'btnPrimary')} type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileEditorModal(props: {
  profiles: ScheduleProfile[]
  activeProfileId: string | null
  draft: ScheduleProfile | null
  onPick: (profile: ScheduleProfile) => void
  onNew: () => void
  onClose: () => void
  onDeleteActive: () => void
  onSave: () => void
  onDraftChange: (profile: ScheduleProfile | null) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="modalCard wide">
        <div className="modalTop">
          <h3>{t('manageViews')}</h3>
          <button className="pillLink" type="button" onClick={props.onClose}>
            {t('close')}
          </button>
        </div>

        <div className="profileEditorLayout">
          <aside className="profileList">
            {props.profiles.map((p) => (
              <button
                key={p.id}
                className={clsx('profileItem', p.id === props.activeProfileId && 'profileItemActive')}
                type="button"
                onClick={() => props.onPick(p)}
              >
                <b>{p.title}</b>
                <span>/{p.slug}</span>
              </button>
            ))}
            <button className="btn" type="button" onClick={props.onNew}>
              {t('newView')}
            </button>
          </aside>

          <div className="profileForm">
            {!props.draft ? <div className="emptyDay">{t('pickView')}</div> : null}
            {props.draft ? (
              <>
                <label className="field">
                  <span>{t('title')}</span>
                  <input
                    className="modalInput"
                    value={props.draft.title}
                    onChange={(e) => props.onDraftChange({ ...props.draft!, title: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span>{t('slug')}</span>
                  <input
                    className="modalInput"
                    value={props.draft.slug}
                    onChange={(e) => props.onDraftChange({ ...props.draft!, slug: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span>{t('description')}</span>
                  <textarea
                    className="modalInput"
                    rows={3}
                    value={props.draft.description ?? ''}
                    onChange={(e) => props.onDraftChange({ ...props.draft!, description: e.target.value || null })}
                  />
                </label>

                <div className="editorGrid twoCol">
                  <label className="field">
                    <span>{t('mode')}</span>
                    <select
                      className="modalInput"
                      value={props.draft.mode}
                      onChange={(e) => props.onDraftChange({ ...props.draft!, mode: e.target.value as ScheduleMode })}
                    >
                      <option value="weekly">{t('recurringMode')}</option>
                      <option value="calendar">{t('calendarMode')}</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>{t('language')}</span>
                    <select
                      className="modalInput"
                      value={props.draft.default_language ?? 'ro'}
                      onChange={(e) =>
                        props.onDraftChange({ ...props.draft!, default_language: e.target.value as 'ro' | 'en' | 'ru' })
                      }
                    >
                      {LANGS.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>{t('timezone')}</span>
                    <input
                      className="modalInput"
                      value={props.draft.timezone ?? ''}
                      onChange={(e) => props.onDraftChange({ ...props.draft!, timezone: e.target.value || null })}
                    />
                  </label>

                  <label className="field">
                    <span>{t('publicView')}</span>
                    <select
                      className="modalInput"
                      value={props.draft.is_public ? '1' : '0'}
                      onChange={(e) => props.onDraftChange({ ...props.draft!, is_public: e.target.value === '1' })}
                    >
                      <option value="1">{t('yes')}</option>
                      <option value="0">{t('no')}</option>
                    </select>
                  </label>
                </div>

                <div className="actions between">
                  <button className="btn" type="button" onClick={props.onDeleteActive}>
                    {t('delete')}
                  </button>
                  <button className={clsx('btn', 'btnPrimary')} type="button" onClick={props.onSave}>
                    {t('save')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
function AdminRequestsPanel(props: {
  timezone: string
  lang: 'ro' | 'en' | 'ru'
  requests: SlotRequest[]
  loading: boolean
  query: string
  filter: 'all' | 'pending' | 'approved' | 'rejected'
  onQueryChange: (value: string) => void
  onFilterChange: (value: 'all' | 'pending' | 'approved' | 'rejected') => void
  onReview: (requestId: string, status: 'approved' | 'rejected', adminNote: string) => Promise<void>
  onUpdate: (input: {
    requestId: string
    studentName: string
    studentContact: string
    studentClass: string
    studentNote: string
  }) => Promise<void>
  onDelete: (requestId: string) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <section className="surfaceCard">
      <div className="scheduleHeader">
        <div>
          <h2 className="sectionTitle">{t('adminRequests')}</h2>
          <p className="sectionSub">{t('requestsHelper')}</p>
        </div>
        <div className="requestToolbar">
          <input
            className="modalInput searchInput"
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder={t('searchRequests')}
          />
          <select
            className="modalInput statusFilter"
            value={props.filter}
            onChange={(e) => props.onFilterChange(e.target.value as 'all' | 'pending' | 'approved' | 'rejected')}
          >
            <option value="all">{t('all')}</option>
            <option value="pending">{t('pending')}</option>
            <option value="approved">{t('approved')}</option>
            <option value="rejected">{t('rejected')}</option>
          </select>
        </div>
      </div>

      {props.loading ? (
        <div className="emptyDay">{t('loading')}</div>
      ) : props.requests.length === 0 ? (
        <div className="emptyDay">{t('noRequests')}</div>
      ) : (
        <div className="adminRequestsGrid">
          {props.requests.map((request) => {
            const slot: Slot = {
              id: request.slot_id,
              profile_id: request.profile_id,
              slot_date: request.slot_date,
              day_of_week: request.slot_day_of_week ?? 1,
              start_time: request.slot_start_time ?? '00:00',
              end_time: request.slot_end_time ?? '00:00',
              status: SlotStatus.Available,
              spots_total: null,
              spots_available: null,
              label: request.slot_label ?? '-',
              note: null,
              visibility: true,
            }
            const display = slotToDisplayTimes(slot, props.timezone, props.timezone, props.lang)

            return (
              <AdminRequestCard
                key={request.id}
                request={request}
                display={display}
                onUpdate={props.onUpdate}
                onReview={props.onReview}
                onDelete={props.onDelete}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function AdminRequestCard(props: {
  request: SlotRequest
  display: { dayLabel: string; range: string }
  onReview: (requestId: string, status: 'approved' | 'rejected', adminNote: string) => Promise<void>
  onUpdate: (input: {
    requestId: string
    studentName: string
    studentContact: string
    studentClass: string
    studentNote: string
  }) => Promise<void>
  onDelete: (requestId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(props.request.student_name ?? '')
  const [contact, setContact] = useState(props.request.student_contact ?? '')
  const [classGrade, setClassGrade] = useState(props.request.student_class ?? '')
  const [studentNote, setStudentNote] = useState(props.request.student_note ?? '')
  const [adminNote, setAdminNote] = useState(props.request.admin_note ?? '')
  const [busy, setBusy] = useState(false)

  const runUpdate = async () => {
    if (!name.trim() || !contact.trim()) return
    setBusy(true)
    try {
      await props.onUpdate({
        requestId: props.request.id,
        studentName: name,
        studentContact: contact,
        studentClass: classGrade,
        studentNote,
      })
    } finally {
      setBusy(false)
    }
  }

  const runReview = async (status: 'approved' | 'rejected') => {
    setBusy(true)
    try {
      await props.onReview(props.request.id, status, adminNote)
    } finally {
      setBusy(false)
    }
  }

  const runDelete = async () => {
    setBusy(true)
    try {
      await props.onDelete(props.request.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="adminRequestCard">
      <div className="adminRequestTop">
        <div>
          <div className="slotLabel compact">{props.display.dayLabel} · {props.display.range}</div>
          <div className="slotMeta">{props.request.slot_label ?? '-'}</div>
          <div className="slotMeta">/{props.request.profile_slug ?? '-'}</div>
        </div>
        <div className={clsx('statusPill', props.request.status === 'pending' ? 'statusFew' : props.request.status === 'approved' ? 'statusAvailable' : 'statusFull')}>
          {t(props.request.status)}
        </div>
      </div>

      <input className="modalInput" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('student')} />
      <input className="modalInput" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('contact')} />
      <input className="modalInput" value={classGrade} onChange={(e) => setClassGrade(e.target.value)} placeholder={t('classGrade')} />
      <textarea className="modalInput" rows={3} value={studentNote} onChange={(e) => setStudentNote(e.target.value)} placeholder={t('message')} />
      <textarea className="modalInput" rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder={t('adminNote')} />

      <div className="actions wrap">
        <button className="btn" type="button" onClick={() => void runUpdate()} disabled={busy || !name.trim() || !contact.trim()}>
          {t('saveChanges')}
        </button>
        <button className={clsx('btn', 'btnPrimary')} type="button" onClick={() => void runReview('approved')} disabled={busy || props.request.status !== 'pending'}>
          {t('accept')}
        </button>
        <button className="btn" type="button" onClick={() => void runReview('rejected')} disabled={busy || props.request.status !== 'pending'}>
          {t('reject')}
        </button>
        <button className="btn danger" type="button" onClick={() => void runDelete()} disabled={busy}>
          {t('delete')}
        </button>
      </div>
    </article>
  )
}
