// Small building blocks for Studio's screens: a DOM helper, and form fields
// made from the shared schema so Studio asks for exactly what the build expects.

/** h('div', { class: 'x', onClick: fn }, child, 'text') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (['checked', 'disabled', 'hidden', 'required', 'multiple', 'open'].includes(key)) el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let counter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 6)}`;

const splitList = (s) => [
  ...new Set(
    String(s)
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

function frame(def, id, control, { label = true } = {}) {
  const hint = def.hint ? h('p', { class: 'field__hint', id: `${id}-hint` }, def.hint) : null;
  const counter = def.max ? h('span', { class: 'field__count', id: `${id}-count` }) : null;
  const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
  const top = label
    ? h('label', { for: id, class: 'field__label' }, def.label, def.required ? h('span', { class: 'field__req' }, ' (required)') : null)
    : null;
  return { top, hint, counter, error };
}

/**
 * @returns {{ el: HTMLElement, read: () => any, setError: (message: string) => void, focus: () => void, key: string }}
 */
export function buildField(def, value, { onInput = () => {} } = {}) {
  const id = uid(`f-${def.key}`);
  const describedBy = (parts) => parts.filter(Boolean).join(' ');

  const setErrorOn = (el, error, controls) => (message) => {
    error.hidden = !message;
    error.textContent = message || '';
    for (const c of controls) {
      if (message) {
        c.setAttribute('aria-invalid', 'true');
        c.setAttribute('aria-describedby', describedBy([def.hint ? `${id}-hint` : '', error.id]));
      } else {
        c.removeAttribute('aria-invalid');
        c.setAttribute('aria-describedby', describedBy([def.hint ? `${id}-hint` : '']));
      }
    }
  };

  // Single check boxes: "show on the home page", "I have permission..."
  if (def.type === 'bool' || def.type === 'confirm') {
    const input = h('input', { type: 'checkbox', id, checked: value === true, onChange: onInput });
    const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
    const el = h('div', { class: 'field field--check' }, h('label', { class: 'check', for: id }, input, h('span', null, def.label)), error);
    return { key: def.key, el, read: () => input.checked, setError: setErrorOn(el, error, [input]), focus: () => input.focus() };
  }

  // One of a few choices, as large tappable buttons
  if (def.type === 'choice') {
    const name = uid('choice');
    const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
    const radios = def.options.map((o) =>
      h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: o.value, checked: value === o.value, onChange: onInput }), h('span', null, o.label)),
    );
    const el = h(
      'fieldset',
      { class: 'field field--choice' },
      h('legend', { class: 'field__label' }, def.label, def.required ? h('span', { class: 'field__req' }, ' (required)') : null),
      h('div', { class: 'choices' }, radios),
      error,
    );
    const inputs = () => [...el.querySelectorAll('input')];
    return {
      key: def.key,
      el,
      read: () => inputs().find((i) => i.checked)?.value ?? '',
      setError: setErrorOn(el, error, []),
      focus: () => (inputs().find((i) => i.checked) ?? inputs()[0])?.focus(),
    };
  }

  // Web links: a label and an address per row
  if (def.type === 'links') {
    const rows = h('div', { class: 'link-rows' });
    const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
    const addRow = (link = {}) => {
      const label = h('input', { type: 'text', 'aria-label': 'Link label', placeholder: 'Report (PDF)', value: link.label ?? '', onInput });
      const url = h('input', { type: 'url', 'aria-label': 'Link address', placeholder: 'https://', value: link.url ?? '', onInput });
      const row = h(
        'div',
        { class: 'link-row' },
        label,
        url,
        h('button', { type: 'button', class: 'btn btn--small', onClick: () => { row.remove(); onInput(); } }, 'Remove'),
      );
      rows.append(row);
      return label;
    };
    for (const l of Array.isArray(value) ? value : []) addRow(l);
    const add = h('button', { type: 'button', class: 'btn btn--small', onClick: () => { addRow().focus(); onInput(); } }, 'Add a link');
    const el = h(
      'fieldset',
      { class: 'field' },
      h('legend', { class: 'field__label' }, def.label),
      def.hint ? h('p', { class: 'field__hint' }, def.hint) : null,
      rows,
      add,
      error,
    );
    return {
      key: def.key,
      el,
      read: () =>
        [...rows.children]
          .map((r) => ({ label: r.children[0].value.trim(), url: r.children[1].value.trim() }))
          .filter((l) => l.label || l.url),
      setError: setErrorOn(el, error, []),
      focus: () => (rows.querySelector('input') ?? add).focus(),
    };
  }

  // Everything else is a text box
  const multiline = def.multiline === true;
  const type = def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : def.type === 'date' ? 'date' : 'text';
  const initial = def.type === 'list' ? (Array.isArray(value) ? value.join(', ') : '') : (value ?? '');
  const parts = frame(def, id);
  const input = multiline
    ? h('textarea', { id, rows: 3, value: initial, placeholder: def.placeholder, onInput })
    : h('input', { id, type, value: initial, placeholder: def.placeholder, autocomplete: 'off', spellcheck: type === 'text' ? 'true' : 'false', onInput });
  if (def.type === 'email') input.setAttribute('inputmode', 'email');
  const updateCount = () => {
    if (parts.counter) {
      const n = [...input.value].length;
      parts.counter.textContent = `${n} of ${def.max}`;
      parts.counter.classList.toggle('field__count--over', n > def.max);
    }
  };
  input.addEventListener('input', updateCount);
  updateCount();
  const el = h('div', { class: 'field' }, parts.top, parts.hint, input, parts.counter, parts.error);
  if (def.hint) input.setAttribute('aria-describedby', `${id}-hint`);
  return {
    key: def.key,
    el,
    read: () => (def.type === 'list' ? splitList(input.value) : input.value.trim()),
    setError: setErrorOn(el, parts.error, [input]),
    focus: () => input.focus(),
  };
}
