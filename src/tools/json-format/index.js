import { h, debounce, formatBytes } from '../../core/dom.js';
import { seg, toolbar, field, statusBar, copyButton, hintLine } from '../../core/ui.js';
import { isAllowedFile, extensionList } from '../../core/files.js';

// 只收纯文本类的 JSON；xlsx / pdf 这类二进制文件读出来是乱码，直接挡在门外
const IMPORT_EXTENSIONS = ['json', 'txt'];

const SAMPLE = '{"name":"use-tools","version":"0.1.0","features":["json","base64","timestamp"],"ready":true}';

function stringify(value, indent) {
  return JSON.stringify(value, null, indent);
}

export default {
  id: 'json-format',
  name: 'JSON 格式化',
  desc: '格式化、压缩、校验 JSON，支持键排序与文件导入导出',
  icon: '{}',
  group: '文本与编码',
  keywords: ['json', 'format', 'beautify', 'minify', '格式化', '压缩', '校验'],

  mount({ root, api, actions }) {
    let indent = 2;
    let sortKeys = false;

    const input = h('textarea', {
      class: 'textarea',
      placeholder: `在此粘贴 JSON，或点击右上角「导入文件」\n\n示例：\n${SAMPLE}`,
      spellcheck: 'false',
    });

    const output = h('textarea', {
      class: 'textarea',
      readonly: true,
      placeholder: '结果会显示在这里',
      spellcheck: 'false',
    });

    const status = statusBar('等待输入');

    const inputMeta = h('span', { class: 'meta' }, ['0 字符']);
    const outputMeta = h('span', { class: 'meta' }, ['—']);

    /** 排序对象键（递归），数组保持原顺序 */
    function sortDeep(value) {
      if (Array.isArray(value)) return value.map(sortDeep);
      if (value && typeof value === 'object') {
        return Object.keys(value)
          .sort()
          .reduce((acc, key) => {
            acc[key] = sortDeep(value[key]);
            return acc;
          }, {});
      }
      return value;
    }

    function transform() {
      const raw = input.value;
      inputMeta.textContent = `${raw.length} 字符 · ${formatBytes(new Blob([raw]).size)}`;

      if (!raw.trim()) {
        output.value = '';
        outputMeta.textContent = '—';
        status.set('', '等待输入');
        input.classList.remove('is-invalid');
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const target = sortKeys ? sortDeep(parsed) : parsed;
        output.value = stringify(target, indent);
        outputMeta.textContent = `${output.value.length} 字符 · ${formatBytes(new Blob([output.value]).size)}`;
        status.set('ok', 'JSON 合法');
        input.classList.remove('is-invalid');
      } catch (err) {
        output.value = '';
        outputMeta.textContent = '—';
        status.set('err', `解析失败：${err.message}`);
        input.classList.add('is-invalid');
      }
    }

    const lazyTransform = debounce(transform, 150);
    input.addEventListener('input', lazyTransform);

    const indentSeg = seg(
      [
        { id: '2', label: '2 空格', hint: '每层缩进 2 个空格' },
        { id: '4', label: '4 空格', hint: '每层缩进 4 个空格' },
        { id: '0', label: '单行', hint: '压成一行，去掉所有换行与缩进' },
      ],
      String(indent),
      (id) => {
        indent = Number(id);
        transform();
      }
    );

    const sortBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        title: '递归排序对象键，数组顺序不变',
        onClick: () => {
          sortKeys = !sortKeys;
          sortBtn.classList.toggle('btn-primary', sortKeys);
          transform();
        },
      },
      ['键排序']
    );

    const copyBtn = copyButton(() => output.value, (text) => api.clipboard.writeText(text));

    const importBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          const filePath = await api.pickFile({
            title: '选择 JSON 文件',
            filters: [{ name: `JSON / 文本（${extensionList(IMPORT_EXTENSIONS)}）`, extensions: IMPORT_EXTENSIONS }],
          });
          if (!filePath) return;
          const name = await api.basename(filePath);
          if (!isAllowedFile(name, IMPORT_EXTENSIONS)) {
            status.set('err', `只能导入 ${extensionList(IMPORT_EXTENSIONS)} 文件，${name} 不支持`);
            return;
          }
          try {
            input.value = await api.readText(filePath);
            transform();
          } catch (err) {
            status.set('err', `读取失败：${err.message}`);
          }
        },
      },
      ['导入文件']
    );

    const saveBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          if (!output.value) return;
          await api.saveText({
            title: '保存 JSON',
            defaultName: 'output.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            content: output.value,
          });
        },
      },
      ['保存结果']
    );

    const sampleBtn = h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        onClick: () => {
          input.value = SAMPLE;
          transform();
        },
      },
      ['填入示例']
    );

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

    // 文件类操作放顶栏，内容级操作放工具栏，全站一致
    actions.append(importBtn, saveBtn);

    root.append(
      toolbar([indentSeg, sortBtn], [sampleBtn, clearBtn]),
      h('div', { class: 'split' }, [
        field('输入', input, inputMeta),
        field('输出', output, [outputMeta, copyBtn]),
      ]),
      status.el,
      hintLine('粘贴即格式化；「键排序」会递归排序对象键，数组保持原顺序。')
    );

    transform();
    input.focus();

    return () => {
      input.removeEventListener('input', lazyTransform);
    };
  },
};
