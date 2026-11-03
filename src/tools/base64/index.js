import { h, debounce } from '../../core/dom.js';
import { seg, toolbar, field, statusBar, copyButton, hintLine } from '../../core/ui.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(text, urlSafe) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  let out = btoa(binary);
  if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return out;
}

function fromBase64(input, urlSafe) {
  let normalized = input.replace(/\s+/g, '');
  if (urlSafe || /[-_]/.test(normalized)) {
    normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
  }
  while (normalized.length % 4 !== 0) normalized += '=';

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return decoder.decode(bytes); // 非 UTF-8 会抛错，交给上层提示
}

export default {
  id: 'base64',
  name: 'Base64 编解码',
  desc: '文本与 Base64 互转，UTF-8 安全，支持 URL 安全字符集',
  icon: 'B6',
  group: '文本与编码',
  keywords: ['base64', 'encode', 'decode', '编码', '解码'],

  mount({ root, api }) {
    let mode = 'encode';
    let urlSafe = false;

    const input = h('textarea', { class: 'textarea', placeholder: '在此输入内容', spellcheck: 'false' });
    const output = h('textarea', {
      class: 'textarea',
      readonly: true,
      placeholder: '结果显示在这里',
      spellcheck: 'false',
    });

    const status = statusBar('等待输入');
    const inputMeta = h('span', { class: 'meta' }, ['0 字符']);
    const outputMeta = h('span', { class: 'meta' }, ['—']);

    const modeSeg = seg(
      [
        { id: 'encode', label: '编码', hint: '文本 → Base64' },
        { id: 'decode', label: '解码', hint: 'Base64 → 文本（按 UTF-8 解析）' },
      ],
      mode,
      (id) => setMode(id)
    );

    const urlSafeBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        title: '把 + / 换成 - _ 并去掉尾部 =，适合放进 URL 或文件名',
        onClick: () => {
          urlSafe = !urlSafe;
          urlSafeBtn.classList.toggle('btn-primary', urlSafe);
          transform();
        },
      },
      ['URL 安全']
    );

    const copyBtn = copyButton(() => output.value, (text) => api.clipboard.writeText(text));

    const swapBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        title: '把结果放回输入框，并切换编码 / 解码方向',
        onClick: () => {
          const produced = output.value;
          if (!produced) return;
          setMode(mode === 'encode' ? 'decode' : 'encode');
          input.value = produced;
          transform();
        },
      },
      ['反向转换']
    );

    function setMode(next) {
      mode = next;
      for (const btn of modeSeg.querySelectorAll('button')) {
        btn.classList.toggle('is-on', btn.dataset.id === mode);
      }
      input.placeholder = mode === 'encode' ? '输入要编码的文本' : '输入要解码的 Base64';
      transform();
    }

    function transform() {
      const raw = input.value;
      inputMeta.textContent = `${raw.length} 字符`;
      if (!raw) {
        output.value = '';
        outputMeta.textContent = '—';
        status.set('', '等待输入');
        input.classList.remove('is-invalid');
        return;
      }

      try {
        output.value = mode === 'encode' ? toBase64(raw, urlSafe) : fromBase64(raw, urlSafe);
        outputMeta.textContent = `${output.value.length} 字符`;
        status.set('ok', mode === 'encode' ? '编码完成' : '解码完成（按 UTF-8 解析）');
        input.classList.remove('is-invalid');
      } catch (err) {
        output.value = '';
        outputMeta.textContent = '—';
        status.set('err', '解码失败：不是合法的 Base64 或不是 UTF-8 文本');
        input.classList.add('is-invalid');
      }
    }

    const lazyTransform = debounce(transform, 120);
    input.addEventListener('input', lazyTransform);

    const clearBtn = h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        onClick: () => {
          input.value = '';
          transform();
          input.focus();
        },
      },
      ['清空']
    );

    root.append(
      toolbar([modeSeg, urlSafeBtn], [swapBtn, clearBtn]),
      h('div', { class: 'split' }, [
        field('输入', input, inputMeta),
        field('输出', output, [outputMeta, copyBtn]),
      ]),
      status.el,
      hintLine('「URL 安全」会把 + / 换成 - _ 并去掉尾部 =，适合放进 URL 或文件名。')
    );

    transform();
    input.focus();

    return () => {
      input.removeEventListener('input', lazyTransform);
    };
  },
};
