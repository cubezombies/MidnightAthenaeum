'use strict';

document.getElementById('version').textContent =
  new URLSearchParams(location.search).get('v') || '0.1.0';
document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
