/**
 * Preview build only: a small switcher in the corner, since the static copy
 * has no subdomains to tell the storefronts and the admin apps apart.
 */
const LINKS: [string, string][] = [
  ['Shop: Nordic Heat', '?shop=nordic#/'],
  ['Shop: Fjord', '?shop=fjord#/'],
  ['Shop: Kelo', '?shop=kelo#/'],
  ['Reseller admin', '?shop=nordic#/admin'],
  ['Manufacturer admin', '?app=admin#/'],
  ['Platform page', '?app=platform#/'],
];

export function mountPreviewBar() {
  const box = document.createElement('details');
  box.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483000;font:500 12px/1.4 system-ui,sans-serif;background:#1c1c1c;color:#fff;border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:220px');
  const sum = document.createElement('summary');
  sum.textContent = 'Preview: switch app';
  sum.setAttribute('style', 'cursor:pointer;list-style:none');
  box.append(sum);
  for (const [label, href] of LINKS) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = window.location.pathname + href;
    a.setAttribute('style', 'display:block;color:#fff;padding:5px 0;text-decoration:none;opacity:.9');
    // A new query string needs a full load, so the right app boots.
    a.addEventListener('click', e => {
      e.preventDefault();
      window.location.assign(a.href);
      if (href.includes('#') && window.location.search === new URL(a.href).search) window.location.reload();
    });
    box.append(a);
  }
  const note = document.createElement('p');
  note.textContent = 'Sample data. Any e-mail logs in; staff code: any 6 digits.';
  note.setAttribute('style', 'margin:6px 0 0;opacity:.6;font-weight:400');
  box.append(note);
  document.body.append(box);
}
