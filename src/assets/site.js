function $(sel){ return document.querySelector(sel); }

const btn = document.querySelector('[data-copy-summary]');
if(btn){
  btn.addEventListener('click', async () => {
    const ta = document.querySelector('[data-copy-area]');
    const text = ta?.value || ta?.textContent || '';
    try {
      await navigator.clipboard.writeText(text.trim());
      btn.textContent = 'Copied.';
      setTimeout(()=> btn.textContent = 'Copy link + summary', 1200);
    } catch (e) {
      // fallback
      ta?.select?.();
      document.execCommand('copy');
      btn.textContent = 'Copied (fallback).';
      setTimeout(()=> btn.textContent = 'Copy link + summary', 1600);
    }
  });
}
