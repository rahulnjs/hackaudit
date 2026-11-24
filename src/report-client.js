const announce = text => { document.getElementById('announcement').textContent = text }

const themeButton = document.getElementById('theme-toggle')
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  themeButton.setAttribute('aria-pressed', String(dark))
  themeButton.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme')
}
let savedTheme
try { savedTheme = localStorage.getItem('hj-theme') } catch {}
applyTheme(savedTheme === 'dark' || (savedTheme == null && window.matchMedia('(prefers-color-scheme: dark)').matches))
themeButton.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark'
  applyTheme(dark)
  try { localStorage.setItem('hj-theme', dark ? 'dark' : 'light') } catch {}
})

const progress = document.getElementById('reading-progress')
function updateProgress() {
  const available = document.documentElement.scrollHeight - window.innerHeight
  progress.style.transform = 'scaleX(' + (available > 0 ? window.scrollY / available : 0) + ')'
}
window.addEventListener('scroll', updateProgress, { passive: true })
window.addEventListener('resize', updateProgress)
updateProgress()

document.querySelectorAll('[data-filter]').forEach(input => {
  input.addEventListener('input', () => {
    const target = document.getElementById(input.dataset.filter)
    if (!target) return
    const query = input.value.toLocaleLowerCase().trim()
    const rows = [...target.querySelectorAll('[data-filter-row]')]
    let visible = 0
    rows.forEach(row => {
      row.hidden = !row.textContent.toLocaleLowerCase().includes(query)
      if (!row.hidden) visible++
    })
    const empty = document.querySelector('[data-empty-for="' + input.dataset.filter + '"]')
    if (empty) empty.hidden = visible !== 0 || rows.length === 0
    announce(visible + ' matching records')
  })
})

document.getElementById('expand-prompts').addEventListener('click', event => {
  const expand = event.currentTarget.getAttribute('aria-pressed') !== 'true'
  document.querySelectorAll('.prompt-card').forEach(card => card.classList.toggle('expanded', expand))
  event.currentTarget.setAttribute('aria-pressed', String(expand))
  event.currentTarget.textContent = expand ? 'Collapse all' : 'Expand all'
})

document.getElementById('print-report').addEventListener('click', () => window.print())
document.getElementById('download-json').addEventListener('click', () => {
  const report = JSON.parse(document.getElementById('report-data').textContent)
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'hackaudit-' + report.report_id + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  announce('JSON report exported')
})

const navigation = [...document.querySelectorAll('nav a')]
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)
    if (!visible.length) return
    navigation.forEach(link => {
      const active = link.hash === '#' + visible[0].target.id
      link.classList.toggle('active', active)
      if (active) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    })
  }, { rootMargin: '-12% 0px -65% 0px' })
  document.querySelectorAll('main > section').forEach(section => observer.observe(section))
}

let printState = []
window.addEventListener('beforeprint', () => {
  printState = [...document.querySelectorAll('details')].map(element => [element, element.open])
  printState.forEach(([element]) => { element.open = true })
  document.querySelectorAll('[hidden]').forEach(element => element.setAttribute('data-print-hidden', ''))
})
window.addEventListener('afterprint', () => {
  printState.forEach(([element, open]) => { element.open = open })
  document.querySelectorAll('[data-print-hidden]').forEach(element => element.removeAttribute('data-print-hidden'))
})
