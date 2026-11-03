import { h, debounce } from '../../core/dom.js';
import { seg, setSegValue, toolbar, field, statusBar, copyButton, hintLine } from '../../core/ui.js';
import { convert, stripShell, normalizeNewlines } from './parse.js';

/**
 * SQL IN 生成器
 * 把散落的数据（多行 / 逗号分隔 / 直接从 SQL 里复制的一段 IN (...)）整理成可用的 IN 列表，
 * 也能反向吐出纯净的数据列。
 */

// 每个选项都带 hint：界面上只放短标签，鼠标悬停补一句「这个选项到底产出什么」
const MODES = [
  { id: 'in-line', label: 'IN 单行', hint: '输出成一行 IN (…)，直接贴进 SQL' },
  { id: 'in-block', label: 'IN 多行', hint: '每个值占一行，长列表更好读' },
  { id: 'list', label: '值列表', hint: '每行末尾带逗号，方便粘进已有的括号' },
  { id: 'plain', label: '纯数据列', hint: '只输出原始值，不加引号、不带 IN' },
];

const SEPARATORS = [
  { id: 'auto', label: '自动', hint: '自动识别换行、逗号、分号、制表符' },
  { id: 'newline', label: '换行', hint: '只按换行切分；值本身带逗号时用这个' },
  { id: 'comma', label: '逗号', hint: '按半角 / 全角逗号切分' },
  { id: 'semicolon', label: '分号', hint: '按分号切分' },
  { id: 'tab', label: '制表符', hint: '从 Excel 复制出来的一列通常是这个' },
  { id: 'space', label: '空格', hint: '按空格切分' },
  { id: 'custom', label: '自定义', hint: '自己填，按字面匹配，支持多字符（如 ||）' },
];

const QUOTES = [
  { id: 'single', label: '单引号', hint: "值包成 'abc'" },
  { id: 'double', label: '双引号', hint: '值包成 "abc"' },
  { id: 'none', label: '不加引号', hint: '只输出值本身，适合数字或已带引号的数据' },
];

const SORTS = [
  { id: 'none', label: '原序', hint: '保持输入里的先后顺序' },
  { id: 'asc', label: '升序', hint: '按字符编码从小到大' },
  { id: 'desc', label: '降序', hint: '按字符编码从大到小' },
];

const ENCODINGS = [
  { id: 'auto', label: '自动', hint: '先按 UTF-8 解，解不开再按 ANSI，绝大多数文件都对' },
  { id: 'utf-8', label: 'UTF-8', hint: '通用编码，Win11 记事本默认也是它' },
  { id: 'gbk', label: 'ANSI', hint: '中文 Windows 的默认编码（GBK / CP936），导入后乱码就换这个' },
];

const SAMPLE = `DIP001
DIP002
DIP003, DIP004
'DIP005'；DIP006`;

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('zh-CN') : '—');

export default {
  id: 'sql-in',
  name: 'SQL IN 生成器',
  desc: '把散乱数据整理成 SQL IN 列表，也能导出纯净数据列',
  icon: 'IN',
  group: '数据库',
  keywords: ['sql', 'in', 'not in', 'query', '查询', '列表', '引号', 'values', '数据库', 'id'],

  mount({ root, api, actions, tool }) {
    const state = {
      mode: 'in-line',
      separatorId: 'auto',
      customSeparator: '',
      quote: 'single',
      numericUnquoted: true,
      nullLiteral: true,
      dedupe: true,
      sort: 'none',
      negate: false,
      column: '',
      chunkSize: 0,
      encoding: 'auto',
    };

    // ------------------------------------------------------------ 配置记忆
    // 连输入内容一起记（上限 20KB，超过只记选项）——这个工具的典型用法是
    // 「昨天粘了一列 ID，今天接着整理」，数据丢了比选项丢了更恼火
    const PERSIST_INPUT_LIMIT = 20 * 1024;
    let touched = false; // persistState 只会被用户操作触发，兼作「已动过」标记

    const persistState = debounce(() => {
      touched = true;
      try {
        api.settings
          .patchTool(tool.id, {
            ...state,
            input: input.value.length <= PERSIST_INPUT_LIMIT ? input.value : '',
          })
          .catch(() => {});
      } catch {
        /* 设置通道不可用时不影响工具本身 */
      }
    }, 600);

    // 记录上一次同步方向时的输入内容：只在「输入变了」时从数据里推断方向，
    // 否则用户手动切 IN / NOT IN 会被立刻改回去（选项变化也会触发 transform）
    let lastSyncedInput = null;

    // ------------------------------------------------------------ 元素
    const input = h('textarea', {
      class: 'textarea',
      spellcheck: 'false',
      placeholder: "粘贴数据，支持多行、逗号分隔、全角逗号，或直接贴一段 IN ('a','b')",
    });

    const output = h('textarea', {
      class: 'textarea',
      spellcheck: 'false',
      readonly: true,
      wrap: 'off',
      placeholder: '结果自动生成',
    });

    const status = statusBar('粘贴数据后自动转换');
    const setStatus = status.set;

    const inputMeta = h('span', { class: 'meta' }, ['0 行']);
    const outputMeta = h('span', { class: 'meta' }, ['0 字符']);

    // ------------------------------------------------------------ 选项
    // 自定义分隔符：标签和输入框打包在一起，显示/隐藏时整块出现，
    // 输入框用 .input-sm 与分段控件同高（26px），避免出现时把整行撑高
    const customWrap = h('div', { class: 'opt-inline', style: { display: 'none' } }, [
      h('span', { class: 'opt-label opt-label-gap' }, ['自定义分隔符']),
      h('input', {
        class: 'input input-sm',
        style: { width: '110px' },
        placeholder: '如 | 或 \\t',
        onInput: (event) => {
          state.customSeparator = event.target.value;
          schedule();
        },
      }),
    ]);

    const modeSeg = seg(MODES, state.mode, (id) => {
      state.mode = id;
      syncInOnly();
      transform();
    });

    const separatorSeg = seg(SEPARATORS, state.separatorId, (id) => {
      state.separatorId = id;
      customWrap.style.display = id === 'custom' ? '' : 'none';
      transform();
    });

    const quoteSeg = seg(QUOTES, state.quote, (id) => {
      state.quote = id;
      transform();
    });

    const sortSeg = seg(SORTS, state.sort, (id) => {
      state.sort = id;
      transform();
    });

    const negateSeg = seg(
      [
        { id: 'in', label: 'IN', hint: '生成 IN (…)' },
        { id: 'not', label: 'NOT IN', hint: '生成 NOT IN (…)，分片时用 AND 连接' },
      ],
      state.negate ? 'not' : 'in',
      (id) => {
        state.negate = id === 'not';
        transform();
      }
    );

    const encodingSeg = seg(ENCODINGS, state.encoding, (id) => {
      state.encoding = id;
    });

    const columnInput = h('input', {
      class: 'input',
      style: { width: '150px' },
      // data-role 给测试定位用，别依赖 placeholder 文案
      dataset: { role: 'column' },
      placeholder: 'id（可留空）',
      value: state.column,
      onInput: (event) => {
        state.column = event.target.value;
        schedule();
      },
    });

    const chunkInput = h('input', {
      class: 'input input-inline',
      type: 'number',
      min: '0',
      step: '100',
      value: '0',
      title: '每 N 个值分一组，0 表示不分片',
      onInput: (event) => {
        const next = parseInt(event.target.value, 10);
        state.chunkSize = Number.isFinite(next) && next > 0 ? next : 0;
        schedule();
      },
    });

    const numericBox = h('input', {
      class: 'checkbox',
      type: 'checkbox',
      checked: true,
      onChange: (event) => {
        state.numericUnquoted = event.target.checked;
        transform();
      },
    });

    const dedupeBox = h('input', {
      class: 'checkbox',
      type: 'checkbox',
      checked: true,
      onChange: (event) => {
        state.dedupe = event.target.checked;
        transform();
      },
    });

    // 「纯数据列 / 值列表」用不到方向、列名和分片，整行隐藏避免干扰
    const inOnlyRows = [];
    function syncInOnly() {
      const show = state.mode === 'in-line' || state.mode === 'in-block';
      for (const row of inOnlyRows) row.style.display = show ? '' : 'none';
    }

    // ------------------------------------------------------------ 转换
    function transform() {
      if (mountDone) persistState();
      const raw = input.value;
      inputMeta.textContent = raw.trim() ? `${fmt(normalizeNewlines(raw).split('\n').length)} 行` : '0 行';

      if (!raw.trim()) {
        output.value = '';
        outputMeta.textContent = '0 字符';
        setStatus('', '粘贴数据后自动转换');
        return;
      }

      if (state.separatorId === 'custom' && !state.customSeparator) {
        output.value = '';
        outputMeta.textContent = '0 字符';
        setStatus('err', '请填写自定义分隔符');
        return;
      }

      // 输入里带 NOT IN 时同步开关，让「整理现成语句」这件事不需要用户再点一次；
      // 只在输入内容变化时做，避免手动切换被覆盖
      const normalized = normalizeNewlines(raw).trim();
      if (normalized !== lastSyncedInput) {
        lastSyncedInput = normalized;
        const shell = stripShell(normalized);
        if (shell.negate !== null && shell.negate !== state.negate) {
          state.negate = shell.negate;
          setSegValue(negateSeg, shell.negate ? 'not' : 'in');
        }
      }

      const result = convert(raw, state);
      output.value = result.text;
      outputMeta.textContent = `${fmt(result.text.length)} 字符`;

      if (result.values.length === 0) {
        setStatus('err', '没有解析出任何值，检查分隔方式');
        return;
      }

      const stats = result.stats;
      const parts = [`输出 ${fmt(result.values.length)} 条`];
      if (stats.duplicates > 0) parts.push(`去重 ${fmt(stats.duplicates)} 条`);
      if (stats.text > 0) parts.push(`文本 ${fmt(stats.text)}`);
      if (stats.numeric > 0) parts.push(`数字 ${fmt(stats.numeric)}`);
      if (stats.nulls > 0) parts.push(`NULL ${fmt(stats.nulls)}`);
      if (stats.chunks > 1) parts.push(`分 ${fmt(stats.chunks)} 片`);
      if (result.stripped) parts.push('已剥离外层语句');

      setStatus('ok', parts.join(' · '));
    }

    const schedule = debounce(transform, 150);
    input.addEventListener('input', schedule);

    // -------------------------------------------------- 状态 → 界面（恢复历史配置用）
    function syncUI() {
      setSegValue(modeSeg, state.mode);
      setSegValue(separatorSeg, state.separatorId);
      customWrap.style.display = state.separatorId === 'custom' ? '' : 'none';
      customWrap.querySelector('input').value = state.customSeparator;
      setSegValue(quoteSeg, state.quote);
      setSegValue(sortSeg, state.sort);
      setSegValue(negateSeg, state.negate ? 'not' : 'in');
      setSegValue(encodingSeg, state.encoding);
      numericBox.checked = state.numericUnquoted;
      dedupeBox.checked = state.dedupe;
      columnInput.value = state.column;
      chunkInput.value = String(state.chunkSize);
      syncInOnly();
    }

    // 只恢复到「用户还没动手」的干净界面，避免把正在输入的内容顶掉
    let mountDone = false;
    api.settings
      .get()
      .then((settings) => {
        if (touched) return;
        const saved = settings?.tools?.[tool.id];
        if (!saved) return;

        for (const key of [
          'mode',
          'separatorId',
          'customSeparator',
          'quote',
          'numericUnquoted',
          'nullLiteral',
          'dedupe',
          'sort',
          'negate',
          'column',
          'chunkSize',
          'encoding',
        ]) {
          if (saved[key] !== undefined) state[key] = saved[key];
        }
        if (typeof saved.input === 'string' && saved.input) input.value = saved.input;

        syncUI();
        transform();
      })
      .catch(() => {});

    // ------------------------------------------------------------ 动作
    const pasteBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          try {
            const text = await api.clipboard.readText();
            if (!text) {
              setStatus('err', '剪贴板里没有文本');
              return;
            }
            input.value = text;
            transform();
          } catch (err) {
            setStatus('err', `读取剪贴板失败：${err.message}`);
          }
        },
      },
      ['从剪贴板粘贴']
    );

    const importBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          const filePath = await api.pickFile({
            title: '选择数据文件',
            filters: [
              { name: '文本 / SQL', extensions: ['txt', 'csv', 'sql', 'log', 'dat'] },
              { name: '所有文件', extensions: ['*'] },
            ],
          });
          if (!filePath) return;
          try {
            const text = await api.readText(filePath, { encoding: state.encoding });
            input.value = text;
            transform();
            setStatus('ok', `已导入 ${await api.basename(filePath)}`);
          } catch (err) {
            setStatus('err', `读取失败：${err.message}`);
          }
        },
      },
      ['导入文件']
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

    const copyBtn = copyButton(() => output.value, (text) => api.clipboard.writeText(text));

    const saveBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          if (!output.value) return;
          const saved = await api.saveText({
            title: '保存结果',
            defaultName: state.mode === 'plain' ? 'column.txt' : 'in-list.sql',
            filters: [
              { name: 'SQL / 文本', extensions: ['sql', 'txt'] },
              { name: '所有文件', extensions: ['*'] },
            ],
            content: output.value,
          });
          if (saved) setStatus('ok', `已保存到 ${saved}`);
        },
      },
      ['保存结果']
    );

    // ------------------------------------------------------------ 组装
    // 文件类操作（导入 / 保存）进顶栏；内容级操作（示例 / 清空）留在工具栏右侧
    actions.append(importBtn, saveBtn);

    // 选项面板：分「输入解析 / 输出内容」两类，标签写具体（不再只写“格式/切分”），
    // 每个选项的详细含义放在 title 里，鼠标悬停可看
    // 一个「标签 + 它的控件」是不可拆的组：宽度够就并排，不够就整组换行，
    // 不会出现「标签留在上一行、控件掉到下一行」的错位
    const optItem = (label, children, labelClass = 'opt-label') =>
      h('div', { class: 'opt-item' }, [
        h('span', { class: labelClass }, [label]),
        ...children,
      ]);
    const optRow = (...items) => h('div', { class: 'opt-row' }, items);

    const directionRow = optRow(
      optItem('语句方向', [negateSeg]),
      optItem('列名', [columnInput], 'opt-label opt-label-gap'),
      optItem('分片', [chunkInput], 'opt-label opt-label-gap')
    );
    inOnlyRows.push(directionRow);

    const optionsCard = h('div', { class: 'card opt-panel' }, [
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['输入解析']),
        optRow(optItem('切分方式', [separatorSeg])),
        // 自定义分隔符是独立的一组，窄屏时整组换行，不挤在同一行里
        optRow(
          optItem('文本编码', [
            encodingSeg,
            h('span', { class: 'opt-note' }, ['仅导入文件时生效']),
          ]),
          customWrap
        ),
      ]),
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['输出内容']),
        // 「数字不加引号 / 去重」是对最终结果的整体处理，跟着输出格式放；
        // 但它自己是一组：窄屏时整组换行，不会被挤成两行文字
        optRow(
          optItem('输出格式', [modeSeg]),
          h('div', { class: 'opt-item' }, [
            h('label', { class: 'check-label' }, [numericBox, '数字不加引号']),
            h('label', { class: 'check-label' }, [dedupeBox, '去重']),
          ])
        ),
        optRow(
          optItem('值引号', [quoteSeg]),
          optItem('值排序', [sortSeg], 'opt-label opt-label-sep')
        ),
        directionRow,
      ]),
    ]);

    root.append(
      toolbar([pasteBtn], [sampleBtn, clearBtn]),
      optionsCard,
      h('div', { class: 'split' }, [
        field('输入', input, inputMeta),
        field('输出', output, [outputMeta, copyBtn]),
      ]),
      status.el,
      hintLine('引号包起来的值不会被逗号切开；直接粘整段 `IN (...)` / `VALUES (...)` 会自动剥掉外壳。')
    );

    syncInOnly();
    transform();
    mountDone = true;
    input.focus();

    return () => {
      input.removeEventListener('input', schedule);
    };
  },
};
