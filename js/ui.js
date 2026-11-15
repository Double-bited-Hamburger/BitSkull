/* BitSkull — small UI component helpers */
(function () {
  'use strict';
  const BS = window.BS;
  const UI = (BS.UI = {});

  UI.el = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const el = UI.el;

  UI.decimals = (step) => { const s = String(step || 1); return s.includes('.') ? s.split('.')[1].length : 0; };
  UI.fmt = (v, step) => (typeof v === 'number' ? v.toFixed(UI.decimals(step)) : v);
  const pct = (inp) => { const mn = +inp.min, mx = +inp.max; inp.style.setProperty('--p', (((+inp.value - mn) / (mx - mn || 1)) * 100).toFixed(1) + '%'); };

  // def: {k,l,type,min,max,step,d,opts}; o: {value,onInput,onChange,lockable,locked,onLock,animated,title}
  UI.param = function (def, o) {
    const type = def.type || 'range';
    const v = o.value === undefined ? def.d : o.value;
    const lab = el('label', { class: 'l', title: (def.l || def.k) + (type === 'range' ? ' — double-click to reset' : '') }, def.l || def.k);
    const wrap = el('div', { class: 'prm ' + (type === 'range' ? 'rng' : type === 'bool' ? 'bool' : type === 'select' ? 'sel' : type === 'color' ? 'col' : 'txt') + (o.animated ? ' anim' : '') });
    const valBox = el('div', { class: 'val' });
    if (o.animated) valBox.append(el('span', { class: 'badge', title: 'Driven by an animation layer' }, 'ANIM'));
    if (o.lockable) {
      const lk = el('button', { class: 'lock' + (o.locked ? ' on' : ''), title: 'Lock (excluded from randomize)', type: 'button' }, o.locked ? '🔒' : '🔓');
      lk.addEventListener('click', () => { const on = !lk.classList.contains('on'); lk.classList.toggle('on', on); lk.textContent = on ? '🔒' : '🔓'; o.onLock && o.onLock(on); });
      valBox.append(lk);
    }
    if (type === 'range') {
      const num = el('input', { type: 'number', min: def.min, max: def.max, step: def.step, value: UI.fmt(v, def.step) });
      const rng = el('input', { type: 'range', min: def.min, max: def.max, step: def.step, value: v });
      pct(rng);
      rng.addEventListener('pointerdown', () => { BS.dragging = true; });
      rng.addEventListener('input', () => { num.value = UI.fmt(+rng.value, def.step); pct(rng); o.onInput && o.onInput(+rng.value); });
      rng.addEventListener('change', () => { BS.dragging = false; o.onChange && o.onChange(+rng.value); });
      num.addEventListener('change', () => { let x = +num.value; if (!isFinite(x)) x = def.d; rng.value = x; pct(rng); o.onChange && o.onChange(x); });
      lab.addEventListener('dblclick', () => { rng.value = def.d; num.value = UI.fmt(def.d, def.step); pct(rng); o.onChange && o.onChange(def.d); });
      valBox.prepend(num);
      wrap.append(lab, valBox, rng);
      wrap.set = (x) => { rng.value = x; num.value = UI.fmt(+x, def.step); pct(rng); };
    } else if (type === 'bool') {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!v;
      cb.addEventListener('change', () => o.onChange && o.onChange(cb.checked));
      valBox.prepend(cb); wrap.append(lab, valBox);
      lab.addEventListener('click', () => { cb.checked = !cb.checked; o.onChange && o.onChange(cb.checked); });
      wrap.set = (x) => { cb.checked = !!x; };
    } else if (type === 'select') {
      const sel = el('select', null, def.opts.map(([val, txt]) => el('option', { value: val }, txt))); sel.value = v;
      sel.addEventListener('change', () => o.onChange && o.onChange(sel.value));
      valBox.prepend(sel); wrap.append(lab, valBox);
      wrap.set = (x) => { sel.value = x; };
    } else if (type === 'color') {
      const c = el('input', { type: 'color', value: v });
      c.addEventListener('input', () => o.onInput && o.onInput(c.value));
      c.addEventListener('change', () => o.onChange && o.onChange(c.value));
      valBox.prepend(c); wrap.append(lab, valBox);
      wrap.set = (x) => { c.value = x; };
    } else {
      const t = el('input', { type: 'text', value: v, spellcheck: 'false' }); let tm = 0;
      t.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => o.onChange && o.onChange(t.value), 250); });
      valBox.prepend(t); wrap.append(lab, valBox);
      wrap.set = (x) => { t.value = x; };
    }
    if (o.title) wrap.title = o.title;
    return wrap;
  };

  let toastT = 0;
  UI.toast = function (msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2200);
  };

  UI.pickFile = function (input) {
    return new Promise((res) => {
      const on = () => { input.removeEventListener('change', on); res(Array.from(input.files || [])); input.value = ''; };
      input.addEventListener('change', on);
      input.click();
    });
  };
})();
