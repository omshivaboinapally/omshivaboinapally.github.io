// Photo viewer. Every photo on a page is an ordinary link to the full picture.
// This script turns those links into a full-screen viewer with Previous, Next
// and Close, arrow keys, Escape, and swipe. Without the script, or in a browser
// that has no <dialog>, the links still open the picture.
(() => {
  'use strict';
  if (typeof HTMLDialogElement === 'undefined') return;
  const links = Array.from(document.querySelectorAll('a[data-lightbox]'));
  if (!links.length) return;

  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label) => {
    const b = make('button', '', label);
    b.type = 'button';
    return b;
  };

  let dialog = null;
  let stage;
  let frame;
  let count;
  let cap;
  let prevBtn;
  let nextBtn;
  let closeBtn;
  let index = 0;

  function build() {
    dialog = make('dialog', 'viewer');
    dialog.setAttribute('aria-label', 'Photo viewer');
    const bar = make('div', 'viewer__bar');
    count = make('span', 'viewer__count');
    count.setAttribute('aria-hidden', 'true');
    const nav = make('div', 'viewer__nav');
    prevBtn = button('Previous');
    nextBtn = button('Next');
    closeBtn = button('Close');
    if (links.length > 1) nav.append(prevBtn, nextBtn);
    nav.append(closeBtn);
    bar.append(count, nav);
    stage = make('div', 'viewer__stage');
    frame = make('picture');
    stage.append(frame);
    cap = make('div', 'viewer__cap');
    cap.setAttribute('aria-live', 'polite');
    dialog.append(bar, stage, cap);
    document.body.append(dialog);

    prevBtn.addEventListener('click', () => show(index - 1));
    nextBtn.addEventListener('click', () => show(index + 1));
    closeBtn.addEventListener('click', () => dialog.close());
    stage.addEventListener('click', (ev) => {
      if (ev.target === stage) dialog.close();
    });
    dialog.addEventListener('keydown', (ev) => {
      if (links.length < 2) return;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        show(index - 1);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        show(index + 1);
      }
    });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('viewer-open');
      frame.replaceChildren();
      const opener = links[index];
      opener.scrollIntoView({ block: 'nearest' });
      opener.focus();
    });

    let startX = 0;
    let startY = 0;
    stage.addEventListener('pointerdown', (ev) => {
      startX = ev.clientX;
      startY = ev.clientY;
    });
    stage.addEventListener('pointerup', (ev) => {
      if (links.length < 2 || ev.pointerType === 'mouse') return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
    });
  }

  function show(i) {
    index = (i + links.length) % links.length;
    const link = links[index];
    const { avif, jpeg, alt, caption, n, w, h } = link.dataset;
    frame.replaceChildren();
    if (avif) {
      const source = make('source');
      source.type = 'image/avif';
      source.srcset = avif;
      source.sizes = '100vw';
      frame.append(source);
    }
    const img = make('img');
    img.srcset = jpeg;
    img.sizes = '100vw';
    img.src = link.href;
    img.alt = alt || '';
    if (w) img.width = Number(w);
    if (h) img.height = Number(h);
    frame.append(img);
    count.textContent = `Photo ${n || index + 1} of ${links.length}`;
    cap.replaceChildren();
    const label = make('span', 'label', `Photo ${n || index + 1}`);
    cap.append(label, document.createTextNode(caption || ''));
    if (alt) cap.append(make('span', 'vh', `. Description: ${alt}`));
  }

  function open(i) {
    if (!dialog) build();
    show(i);
    document.documentElement.classList.add('viewer-open');
    dialog.showModal();
    closeBtn.focus();
  }

  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const target = ev.target instanceof Element ? ev.target.closest('a[data-lightbox]') : null;
    if (!target) return;
    ev.preventDefault();
    open(links.indexOf(target));
  });
})();
