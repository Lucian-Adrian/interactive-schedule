const cssHref = '/interactive-schedule/assets/index-Dgyll0yW.css'
if (!document.querySelector(`link[href="${cssHref}"]`)) {
  const styleLink = document.createElement('link')
  styleLink.rel = 'stylesheet'
  styleLink.href = cssHref
  document.head.appendChild(styleLink)
}

import('/interactive-schedule/assets/index-D7APrk_m.js')
