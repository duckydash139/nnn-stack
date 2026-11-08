try {
  const mode = localStorage.getItem('viewer-mode');
  if (mode === 'dark' || mode === 'light') document.documentElement.dataset.mode = mode;
} catch {}
