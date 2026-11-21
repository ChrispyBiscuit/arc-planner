// Applies the saved theme and interface size before the first paint (kept out of index.html for the CSP).
try {
  if (localStorage.getItem('arc-theme') === 'light') document.documentElement.classList.remove('dark')
  const z = +localStorage.getItem('arc-scale')
  if (z && z !== 100) document.documentElement.style.zoom = z / 100
} catch {}
