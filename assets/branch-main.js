const cssFile = 'index-DeGtzbO8.css'
const jsFile = 'index-DfdIL1pr.js'

const path = window.location.pathname || '/'
const inRepoPath = path.startsWith('/interactive-schedule/')
const bases = inRepoPath
  ? ['/interactive-schedule/', '/']
  : ['/', '/interactive-schedule/']

;(async () => {
  for (const base of bases) {
    const cssHref = `${base}assets/${cssFile}`
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const styleLink = document.createElement('link')
      styleLink.rel = 'stylesheet'
      styleLink.href = cssHref
      document.head.appendChild(styleLink)
    }

    try {
      await import(`${base}assets/${jsFile}`)
      return
    } catch {
      // try next base
    }
  }
})()
