import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { getDefaultTimezone, parsePrefsFromUrl, setPrefsToUrl } from '@/lib/urlState'
import { type ScheduleConfig, type Slot, type SlotRequest, SlotStatus } from '@/lib/types'
import { api } from '@/lib/api'
import { formatWeekRange, slotToDisplayTimes } from '@/lib/time'
import { buildMessage } from '@/lib/message'

const LANGS = [
  { code: 'ro', name: 'Română' },
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
] as const

const DAY_LABELS: Record<'ro' | 'en' | 'ru', readonly string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ro: ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
}

function getDayIndexForSlot(dayOfWeek: number): number {
  // DB: 0=Sunday, 1=Monday ... 6=Saturday.
  // UI tabs: 0=Monday ... 6=Sunday.
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1
}

function isSelectable(status: SlotStatus): boolean {
  return status === SlotStatus.Available || status === SlotStatus.FewLeft
}

export function App() {
  const { i18n, t } = useTranslation()

  const [config, setConfig] = useState<ScheduleConfig | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)

  const [lang, setLang] = useState<'ro' | 'en' | 'ru'>('ro')
  const [timezone, setTimezone] = useState<string>(getDefaultTimezone())
  const [tzEditing, setTzEditing] = useState(false)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mobileDay, setMobileDay] = useState<number>(() => {
    const d = new Date()
    const dow = d.getDay() // 0..6 (Sun..Sat)
    return dow === 0 ? 6 : dow - 1
  })

  const [adminPassword, setAdminPassword] = useState('')
  const [authSending, setAuthSending] = useState(false)
  const [authInfo, setAuthInfo] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminLoginOpen, setAdminLoginOpen] = useState(false)
  const [adminTab, setAdminTab] = useState<'schedule' | 'requests'>('schedule')
  const [editMode, setEditMode] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSlot, setEditorSlot] = useState<Slot | null>(null)
  const [joinSlot, setJoinSlot] = useState<Slot | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [requests, setRequests] = useState<SlotRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)

  const shareCardRef = useRef<HTMLDivElement | null>(null)

  const visibleSlots = useMemo(() => {
    const showFull = config?.show_full_slots ?? true
    return slots
      .filter((s) => (s.visibility ?? true) === true)
      .filter((s) => (showFull ? true : s.status !== SlotStatus.Full))
      .slice()
      .sort((a, b) => (a.day_of_week - b.day_of_week) || a.start_time.localeCompare(b.start_time))
  }, [config?.show_full_slots, slots])

  const selectedSlots = useMemo(() => {
    const byId = new Map(visibleSlots.map((s) => [s.id, s]))
    return selectedIds.map((id) => byId.get(id)).filter(Boolean) as Slot[]
  }, [selectedIds, visibleSlots])

  const weekRangeLabel = useMemo(() => formatWeekRange(timezone, lang), [timezone, lang])

  useEffect(() => {
    const prefs = parsePrefsFromUrl()
    if (prefs.lang && (prefs.lang === 'ro' || prefs.lang === 'en' || prefs.lang === 'ru')) {
      setLang(prefs.lang)
      void i18n.changeLanguage(prefs.lang)
    } else {
      void i18n.changeLanguage('ro')
    }
    if (prefs.tz) setTimezone(prefs.tz)
  }, [i18n])

  useEffect(() => {
    setPrefsToUrl({ lang, tz: timezone })
  }, [lang, timezone])

  useEffect(() => {
    void i18n.changeLanguage(lang)
  }, [i18n, lang])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const [cfg, allSlots] = await Promise.all([api.getConfig(), api.getSlots()])
        if (!mounted) return
        setConfig(cfg)
        if (cfg?.default_language && (cfg.default_language === 'ro' || cfg.default_language === 'en' || cfg.default_language === 'ru')) {
          setLang(cfg.default_language)
        }
        if (cfg?.timezone) setTimezone(cfg.timezone)
        setSlots(allSlots)
      } catch {
        // Keep UI clean; failures show empty state.
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

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
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setAdminLoginOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const loadAdminRequests = useCallback(async () => {
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
    if (!isAdmin) {
      setRequests([])
      return
    }
    void loadAdminRequests()
  }, [isAdmin, loadAdminRequests])

  const title = config?.title ?? t('title')

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

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const copyMessage = useCallback(async () => {
    const msg = buildMessage({
      lang,
      title,
      configTimezone: config?.timezone ?? timezone,
      viewTimezone: timezone,
      weekRangeLabel,
      slots: selectedSlots,
    })
    try {
      await navigator.clipboard.writeText(msg)
    } catch {
      // Fallback: prompt keeps no extra UI.
      window.prompt(t('copyFallback'), msg)
      return
    }
    setAuthInfo(t('copied'))
    window.setTimeout(() => setAuthInfo(null), 2000)
  }, [config?.timezone, lang, selectedSlots, t, timezone, title, weekRangeLabel])

  const downloadImage = useCallback(async () => {
    if (!shareCardRef.current) return
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(shareCardRef.current, {
      cacheBust: true,
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: 'transparent',
    })
    const a = document.createElement('a')
    a.download = `availability-${lang}.png`
    a.href = dataUrl
    a.click()
  }, [lang])

  const loginWithPassword = useCallback(async () => {
    const password = adminPassword.trim()
    if (!password) return
    setAuthSending(true)
    setAuthInfo(null)
    try {
      const ok = await api.loginAdmin(password)
      if (ok) {
        setIsAdmin(true)
        setAdminLoginOpen(false)
        setAdminTab('schedule')
        setAuthInfo(t('adminLoginSuccess'))
        setAdminPassword('')
      } else {
        setAuthInfo(t('adminLoginFailed'))
      }
    } catch {
      setAuthInfo(t('adminLoginFailed'))
    } finally {
      setAuthSending(false)
    }
  }, [adminPassword, t])

  const logoutAdmin = useCallback(() => {
    api.logoutAdmin()
    setIsAdmin(false)
    setAdminLoginOpen(false)
    setAdminTab('schedule')
    setEditMode(false)
    setRequests([])
    setAuthInfo(t('adminLoggedOut'))
  }, [t])

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
      if (isAdmin) void loadAdminRequests()
    },
    [isAdmin, loadAdminRequests, t],
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
      window.setTimeout(() => setAuthInfo(null), 2200)
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
      window.setTimeout(() => setAuthInfo(null), 2200)
    },
    [t],
  )

  const onSaveSlot = useCallback(async (next: Slot) => {
    const saved = await api.saveSlot(next)
    setSlots((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id)
      if (idx === -1) return [...prev, saved]
      const copy = prev.slice()
      copy[idx] = saved
      return copy
    })
    setEditorOpen(false)
  }, [])

  const onDeleteSlot = useCallback(
    async (id: string) => {
      if (!window.confirm(t('confirmDelete'))) return
      await api.deleteSlot(id)
      setSlots((prev) => prev.filter((s) => s.id !== id))
      setEditorOpen(false)
    },
    [t],
  )

  const onDuplicateSlot = useCallback(async (slot: Slot) => {
    const copy: Slot = {
      ...slot,
      id: crypto.randomUUID(),
      label: `${slot.label} (Copy)`,
    }
    const saved = await api.saveSlot(copy)
    setSlots((prev) => [...prev, saved])
    setEditorSlot(saved)
    setEditorOpen(true)
  }, [])

  const bulkHideWeekends = useCallback(async () => {
    const updates = slots.map((s) => (s.day_of_week === 0 || s.day_of_week === 6 ? { ...s, visibility: false } : s))
    setSlots(updates)
    await Promise.all(updates.filter((s) => s.day_of_week === 0 || s.day_of_week === 6).map((s) => api.saveSlot(s)))
  }, [slots])

  const bulkMarkAllOccupied = useCallback(async () => {
    const updates = slots.map((s) => ({ ...s, status: SlotStatus.Occupied }))
    setSlots(updates)
    await Promise.all(updates.map((s) => api.saveSlot(s)))
  }, [slots])

  const bulkSetCapacity = useCallback(async () => {
    const raw = window.prompt(t('capacityPrompt'), '3')
    if (!raw) return
    const cap = Number.parseInt(raw, 10)
    if (!Number.isFinite(cap) || cap < 0) return
    const updates = slots.map((s) => ({ ...s, spots_total: cap, spots_available: Math.min(s.spots_available ?? cap, cap) }))
    setSlots(updates)
    await Promise.all(updates.map((s) => api.saveSlot(s)))
  }, [slots, t])

  const allTimezones = useMemo(() => {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    const list = anyIntl.supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length) return list
    return [
      'Europe/Chisinau',
      'Europe/Bucharest',
      'Europe/London',
      'Europe/Berlin',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
    ]
  }, [])

  const renderSlotCard = (slot: Slot) => {
    const selected = selectedIds.includes(slot.id)
    const display = slotToDisplayTimes(slot, config?.timezone ?? timezone, timezone, lang)
    const pillClass =
      slot.status === SlotStatus.Available
        ? 'statusAvailable'
        : slot.status === SlotStatus.FewLeft
          ? 'statusFew'
          : 'statusFull'
    const disabled = !editMode && !isSelectable(slot.status)
    const spots =
      typeof slot.spots_total === 'number' && slot.spots_total > 0
        ? `${slot.spots_available ?? 0}/${slot.spots_total} ${t('spotsLeft')}`
        : null

    return (
      <button
        key={slot.id}
        className={clsx('slotCard', selected && 'slotCardSelected')}
        type="button"
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => onSlotClick(slot)}
      >
        <div className="slotTop">
          <div style={{ minWidth: 0 }}>
            <div className={clsx('statusPill', pillClass)}>{t(slot.status)}</div>
          </div>
          {selected ? <div className={clsx('statusPill', 'statusAvailable')}>✓</div> : null}
        </div>
        <div className="slotLabel">{display.range}</div>
        <div className="slotMeta">{display.dayLabel}</div>
        <div className="slotMeta">{slot.label}</div>
        {spots ? <div className="slotMeta">{spots}</div> : null}
        {slot.note ? <div className="slotMeta">{slot.note}</div> : null}
        {!editMode && isSelectable(slot.status) ? (
          <div style={{ marginTop: 8 }}>
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

  const dayLabels = DAY_LABELS[lang]
  const showSchedule = !isAdmin || adminTab === 'schedule'
  const showRequests = isAdmin && adminTab === 'requests'

  const openEditorNewSlot = useCallback((dayIndex: number) => {
    const dow = dayIndex === 6 ? 0 : dayIndex + 1
    const base: Slot = {
      id: crypto.randomUUID(),
      day_of_week: dow,
      start_time: '10:00',
      end_time: '11:00',
      status: SlotStatus.Available,
      spots_total: 1,
      spots_available: 1,
      label: 'New Slot',
      note: null,
      visibility: true,
    }
    setEditorSlot(base)
    setEditorOpen(true)
  }, [])

  return (
    <div className="appShell">
      <div className="header">
        <div className="headerInner">
          <div className="titleBlock">
            <h1 className="title">{title}</h1>
            <p className="subtitle">{t('subtitle')}</p>
          </div>

          <div className="pillRow">
            {isAdmin ? (
              <div className="viewTabs" role="tablist" aria-label={t('adminAccess')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={adminTab === 'schedule'}
                  className={clsx('viewTab', adminTab === 'schedule' && 'viewTabActive')}
                  onClick={() => setAdminTab('schedule')}
                >
                  {t('scheduleTab')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={adminTab === 'requests'}
                  className={clsx('viewTab', adminTab === 'requests' && 'viewTabActive')}
                  onClick={() => setAdminTab('requests')}
                >
                  {t('requestsTab')}
                </button>
              </div>
            ) : null}

            {isAdmin ? (
              <button
                className="toggleBtn"
                type="button"
                onClick={() => {
                  setEditMode((v) => !v)
                  setSelectedIds([])
                }}
                aria-pressed={editMode}
              >
                {editMode ? t('viewPublic') : t('editMode')}
              </button>
            ) : null}

            {isAdmin ? (
              <button className="toggleBtn" type="button" onClick={() => void loadAdminRequests()}>
                {t('refreshRequests')}
              </button>
            ) : null}

            {isAdmin ? (
              <button className="pillLink" type="button" onClick={logoutAdmin}>
                {t('logoutAdmin')}
              </button>
            ) : null}

            <div className="pill">
              <span aria-hidden>🌐</span>
              <select value={lang} onChange={(e) => setLang(e.target.value as 'ro' | 'en' | 'ru')} aria-label={t('language')}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="pill">
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                  }}
                >
                  {t('timesShownIn')}
                </span>
                {!tzEditing ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{timezone}</span>
                    <button className="pillLink" type="button" onClick={() => setTzEditing(true)}>
                      {t('change')}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      aria-label={t('timesShownIn')}
                      style={{ textTransform: 'none', fontWeight: 800 }}
                    >
                      {allTimezones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                    <button className="pillLink" type="button" onClick={() => setTzEditing(false)}>
                      {t('done')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {!isAdmin ? (
          <div className="headerInner secretAdminWrap">
            <button
              className={clsx('secretAdminTrigger', adminLoginOpen && 'secretAdminTriggerOpen')}
              type="button"
              onClick={() => setAdminLoginOpen((open) => !open)}
              aria-label={adminLoginOpen ? t('adminClose') : t('adminOpen')}
              title={t('adminShortcut')}
            />
          </div>
        ) : null}
      </div>

      <main className="container">
        {authInfo ? (
          <div className="pill" style={{ borderColor: 'var(--brand-border)', marginBottom: 14, fontWeight: 800 }}>
            {authInfo}
          </div>
        ) : null}

        {loading ? (
          <div className="pill" style={{ justifyContent: 'center', padding: 18, fontWeight: 900 }}>
            {t('loading')}
          </div>
        ) : null}

        {showSchedule && !loading && visibleSlots.length === 0 ? (
          <div className="pill" style={{ justifyContent: 'center', padding: 18, fontWeight: 900 }}>
            {t('noOpenings')}
          </div>
        ) : null}

        {showRequests ? (
          <AdminRequestsPanel
            requests={requests}
            loading={requestsLoading}
            timezone={timezone}
            onReview={reviewRequest}
            onUpdate={updateRequest}
          />
        ) : null}

        {showSchedule ? (
          <>
            <section className="scheduleGrid calendarSurface" aria-label={t('schedule')}>
              {dayLabels.map((d, idx) => {
                const daySlots = slotsByDay.get(idx) ?? []
                return (
                  <div className="dayCol" key={d}>
                    <div className="dayHeader">
                      <span>{d}</span>
                      {editMode ? (
                        <button className="pillLink" type="button" onClick={() => openEditorNewSlot(idx)}>
                          + {t('add')}
                        </button>
                      ) : daySlots.length ? (
                        <small>{t('tapToSelect')}</small>
                      ) : (
                        <small>{t('noOpeningsDay')}</small>
                      )}
                    </div>
                    {daySlots.map(renderSlotCard)}
                  </div>
                )
              })}
            </section>

            <section className="mobileOnly calendarSurface" aria-label={t('schedule')}>
              <div className="dayTabs" role="tablist" aria-label={t('days')}>
                {dayLabels.map((d, idx) => (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={mobileDay === idx}
                    className={clsx('tab', mobileDay === idx && 'tabActive')}
                    onClick={() => setMobileDay(idx)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="dayCol">
                {editMode ? (
                  <div className="dayHeader">
                    <span>{dayLabels[mobileDay]}</span>
                    <button className="pillLink" type="button" onClick={() => openEditorNewSlot(mobileDay)}>
                      + {t('add')}
                    </button>
                  </div>
                ) : null}
                {(slotsByDay.get(mobileDay) ?? []).length === 0 ? (
                  <div className="pill" style={{ justifyContent: 'center', padding: 18, fontWeight: 900 }}>
                    {t('noSessionsOn', { day: dayLabels[mobileDay] })}
                  </div>
                ) : (
                  (slotsByDay.get(mobileDay) ?? []).map(renderSlotCard)
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>

      {showSchedule && selectedIds.length > 0 && !editMode ? (
        <div className="selectionBarWrap">
          <section className="selectionBar" aria-label={t('selection')}>
            <div className="selectionLeft">
              <div className="countBubble">{selectedIds.length}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>{t('selected', { count: selectedIds.length })}</div>
                <button className="clearBtn" type="button" onClick={clearSelection}>
                  {t('clearAll')}
                </button>
              </div>
            </div>
            <div className="actions">
              <button className="btn" type="button" onClick={downloadImage} title={t('downloadImage')}>
                {t('downloadImage')}
              </button>
              <button className={clsx('btn', 'btnPrimary')} type="button" onClick={copyMessage}>
                {t('copyMessage')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div style={{ position: 'fixed', left: -9999, top: 0, width: 900, padding: 20 }}>
        <div
          ref={shareCardRef}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 18,
            background: 'color-mix(in oklab, var(--panel) 92%, transparent)',
            padding: 18,
            width: 900,
            color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{title}</div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>{weekRangeLabel}</div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>
                {t('timesShownIn')}: {timezone}
              </div>
            </div>
            <div className="statusPill statusAvailable" style={{ alignSelf: 'flex-start' }}>
              {t('selectedShort')}: {selectedIds.length}
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {(selectedSlots.length ? selectedSlots : visibleSlots).slice(0, 18).map((s) => {
              const d = slotToDisplayTimes(s, config?.timezone ?? timezone, timezone, lang)
              return (
                <div
                  key={s.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    padding: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 14,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 950 }}>{d.dayLabel}</div>
                    <div style={{ fontWeight: 900, color: 'var(--subtle)', marginTop: 2 }}>{s.label}</div>
                  </div>
                  <div style={{ fontWeight: 950 }}>{d.range}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--subtle)', fontWeight: 800 }}>
            {t('legend')}: {t('Available')} / {t('FewLeft')} / {t('Full')}
          </div>
        </div>
      </div>

      {editMode && editorOpen && editorSlot ? (
        <SlotEditor
          slot={editorSlot}
          onClose={() => setEditorOpen(false)}
          onSave={onSaveSlot}
          onDelete={onDeleteSlot}
          onDuplicate={onDuplicateSlot}
          onBulkHideWeekends={bulkHideWeekends}
          onBulkMarkAllOccupied={bulkMarkAllOccupied}
          onBulkSetCapacity={bulkSetCapacity}
        />
      ) : null}
      {joinOpen && joinSlot ? (
        <JoinSlotModal
          slot={joinSlot}
          lang={lang}
          timezone={timezone}
          configTimezone={config?.timezone ?? timezone}
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
      <div className="adminLoginModal">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('adminAccess')}</h3>
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
          <div className="slotMeta">{t('adminHint')}</div>
          <div className="slotMeta">{t('adminShortcut')}</div>
          <input
            value={props.adminPassword}
            onChange={(e) => props.onChangePassword(e.target.value)}
            placeholder={t('password')}
            type="password"
            autoComplete="current-password"
            className="modalInput"
          />
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
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

function AdminRequestsPanel(props: {
  requests: SlotRequest[]
  loading: boolean
  timezone: string
  onReview: (requestId: string, status: 'approved' | 'rejected', adminNote: string) => Promise<void>
  onUpdate: (input: {
    requestId: string
    studentName: string
    studentContact: string
    studentClass: string
    studentNote: string
  }) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <section className="adminPanel" aria-label={t('adminRequests')}>
      <div className="adminPanelHeader">
        <h2 className="adminPanelTitle">{t('adminRequests')}</h2>
        <span className="statusPill statusFew">{props.requests.filter((r) => r.status === 'pending').length} {t('pending')}</span>
      </div>

      {props.loading ? (
        <div className="pill" style={{ justifyContent: 'center', padding: 14, fontWeight: 900 }}>
          {t('loading')}
        </div>
      ) : props.requests.length === 0 ? (
        <div className="pill" style={{ justifyContent: 'center', padding: 14, fontWeight: 900 }}>
          {t('noRequests')}
        </div>
      ) : (
        <div className="adminRequestsGrid">
          {props.requests.map((request) => {
            const day = request.slot_day_of_week ?? 1
            const slot: Slot = {
              id: request.slot_id,
              day_of_week: day,
              start_time: request.slot_start_time ?? '00:00',
              end_time: request.slot_end_time ?? '00:00',
              status: SlotStatus.Available,
              spots_total: null,
              spots_available: null,
              label: request.slot_label ?? '—',
              note: null,
              visibility: true,
            }
            const display = slotToDisplayTimes(slot, props.timezone, props.timezone, 'en')

            return (
              <AdminRequestCard
                key={request.id}
                request={request}
                display={display}
                onReview={props.onReview}
                onUpdate={props.onUpdate}
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
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(props.request.student_name ?? '')
  const [contact, setContact] = useState(props.request.student_contact ?? '')
  const [classGrade, setClassGrade] = useState(props.request.student_class ?? '')
  const [studentNote, setStudentNote] = useState(props.request.student_note ?? '')
  const [note, setNote] = useState(props.request.admin_note ?? '')
  const [busy, setBusy] = useState(false)

  const runReview = async (status: 'approved' | 'rejected') => {
    setBusy(true)
    try {
      await props.onReview(props.request.id, status, note)
    } finally {
      setBusy(false)
    }
  }

  const runUpdate = async () => {
    if (!contact.trim()) return
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

  return (
    <article className="adminRequestCard">
      <div className="adminRequestTop">
        <div>
          <div className="slotLabel" style={{ margin: 0, fontSize: 16 }}>{props.display.dayLabel} · {props.display.range}</div>
          <div className="slotMeta">{props.request.slot_label ?? '—'}</div>
        </div>
        <div className={clsx('statusPill', props.request.status === 'pending' ? 'statusFew' : props.request.status === 'approved' ? 'statusAvailable' : 'statusFull')}>
          {t(props.request.status)}
        </div>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('student')}
        className="modalInput"
      />
      <input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder={t('contact')}
        className="modalInput"
      />
      <input
        value={classGrade}
        onChange={(e) => setClassGrade(e.target.value)}
        placeholder={t('classGrade')}
        className="modalInput"
      />
      <textarea
        value={studentNote}
        onChange={(e) => setStudentNote(e.target.value)}
        placeholder={t('message')}
        className="adminNote"
        style={{ minHeight: 84 }}
      />

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('adminNote')}
        className="adminNote"
      />

      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" type="button" onClick={() => void runUpdate()} disabled={busy || !contact.trim()}>
          {t('saveChanges')}
        </button>
        <button className={clsx('btn', 'btnPrimary')} type="button" onClick={() => void runReview('approved')} disabled={busy || props.request.status !== 'pending'}>
          {t('accept')}
        </button>
        <button className="btn" type="button" onClick={() => void runReview('rejected')} disabled={busy || props.request.status !== 'pending'}>
          {t('reject')}
        </button>
      </div>
    </article>
  )
}

function JoinSlotModal(props: {
  slot: Slot
  lang: 'ro' | 'en' | 'ru'
  timezone: string
  configTimezone: string
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
    if (!contact.trim()) return
    setSending(true)
    try {
      await props.onSubmit({ slot: props.slot, name, contact, classGrade, note })
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
      <div className="joinModal">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{t('joinSlot')}</h3>
          <button className="pillLink" type="button" onClick={props.onClose}>{t('close')}</button>
        </div>
        <form
          className="modalForm"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="slotMeta" style={{ marginTop: 2 }}>{display.dayLabel} · {display.range}</div>
          <div className="slotMeta">{props.slot.label}</div>

          <input className="modalInput" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('yourName')} />
          <input className="modalInput" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('yourContact')} />
          <input className="modalInput" value={classGrade} onChange={(e) => setClassGrade(e.target.value)} placeholder={t('classGrade')} />
          <textarea className="modalInput" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('yourMessage')} rows={4} />

          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="button" onClick={props.onClose}>{t('cancel')}</button>
            <button className={clsx('btn', 'btnPrimary')} type="submit" disabled={sending || !contact.trim()}>
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
  onClose: () => void
  onSave: (slot: Slot) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDuplicate: (slot: Slot) => Promise<void>
  onBulkHideWeekends: () => Promise<void>
  onBulkMarkAllOccupied: () => Promise<void>
  onBulkSetCapacity: () => Promise<void>
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
      await props.onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: 'color-mix(in oklab, var(--bg) 55%, transparent)',
        backdropFilter: 'blur(10px)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        className="pill"
        style={{
          width: 'min(720px, 100%)',
          borderRadius: 18,
          padding: 16,
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 14,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>{t('editSlot')}</div>
          <button className="pillLink" type="button" onClick={props.onClose}>
            {t('close')}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('start')}
            </span>
            <input
              type="time"
              value={draft.start_time}
              onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('end')}
            </span>
            <input
              type="time"
              value={draft.end_time}
              onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))}
              style={inputStyle}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t('label')}
          </span>
          <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} style={inputStyle} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('status')}
            </span>
            <select
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as SlotStatus }))}
              style={inputStyle}
            >
              {Object.values(SlotStatus).map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('visible')}
            </span>
            <select
              value={(draft.visibility ?? true) ? '1' : '0'}
              onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value === '1' }))}
              style={inputStyle}
            >
              <option value="1">{t('yes')}</option>
              <option value="0">{t('no')}</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('spotsAvailable')}
            </span>
            <input
              type="number"
              value={draft.spots_available ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, spots_available: Number.parseInt(e.target.value || '0', 10) }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('spotsTotal')}
            </span>
            <input
              type="number"
              value={draft.spots_total ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, spots_total: Number.parseInt(e.target.value || '0', 10) }))}
              style={inputStyle}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t('note')}
          </span>
          <textarea
            value={draft.note ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value || null }))}
            style={{ ...inputStyle, minHeight: 86, resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => props.onDuplicate(draft)}>
              {t('duplicate')}
            </button>
            <button className="btn" type="button" onClick={() => props.onDelete(draft.id)}>
              {t('delete')}
            </button>
          </div>
          <button className={clsx('btn', 'btnPrimary')} type="button" onClick={save} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 950, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t('bulkActions')}
          </span>
          <button className="btn" type="button" onClick={props.onBulkMarkAllOccupied}>
            {t('markAllOccupied')}
          </button>
          <button className="btn" type="button" onClick={props.onBulkHideWeekends}>
            {t('hideWeekends')}
          </button>
          <button className="btn" type="button" onClick={props.onBulkSetCapacity}>
            {t('setCapacity')}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: '10px 12px',
  font: 'inherit',
  background: 'color-mix(in oklab, var(--panel) 92%, transparent)',
  color: 'inherit',
}
