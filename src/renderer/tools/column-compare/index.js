import { h, clear, formatBytes, debounce } from '../../core/dom.js';
import { seg, setSegValue, statusBar } from '../../core/ui.js';

/**
 * 列比对
 * 逻辑对齐 Java 版 compareColumns：抽取两边指定列的唯一值，求差集与交集。
 *
 * 与初版的区别：
 *   1. 每一侧都能独立选择数据来源 —— 文件 或 直接粘贴文本（可以拿文件和粘贴内容对比）
 *   2. 实时比对：数据或选项一变就自动重算，不需要点按钮
 *   3. 解析规则与文件路径共用同一份实现（主进程 column-scan.js），避免两条路径行为漂移
 */

const DELIMITER_PRESETS = [
  { id: 'tab', label: '制表符', value: '\t' },
  { id: 'comma', label: '逗号', value: ',' },
  { id: 'semicolon', label: '分号', value: ';' },
  { id: 'pipe', label: '竖线', value: '|' },
  { id: 'custom', label: '自定义', value: '' },
];

const ENCODINGS = [
  { id: 'auto', label: '自动', hint: '能按 UTF-8 解开就用 UTF-8，否则按 ANSI 解码' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gbk', label: 'ANSI', hint: '中文 Windows 的默认编码（GBK / CP936），Excel 导出的 CSV 通常是它' },
];

/** 表格文件：按单元格读，分隔符与编码都不适用 */
const isSheetPath = (name) => /\.(xlsx|xlsm)$/i.test(String(name || ''));

const SOURCE_MODES = [
  { id: 'file', label: '文件' },
  { id: 'text', label: '粘贴' },
];

const TABS = [
  { id: 'onlyInA', label: 'A 有 B 没有' },
  { id: 'onlyInB', label: 'B 有 A 没有' },
  { id: 'inBoth', label: '两者共有' },
  { id: 'all', label: '合并去重' },
];

const DISPLAY_LIMIT = 500; // 列表最多渲染这么多行，复制/导出始终是完整数据
const AUTO_RUN_DELAY = 320; // 实时比对的防抖间隔

const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('zh-CN') : '—');

// 数值友好排序：DIP001 < DIP2 < DIP10
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 允许用户输入 \t \n 这类转义写法，避免打不出制表符 */
function unescapeDelimiter(raw) {
  return raw.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

export default {
  id: 'column-compare',
  name: '列比对',
  desc: '比较两个文件（含 xlsx）或两段文本的指定列，实时找出各自独有与共有的值',
  icon: 'A≠',
  group: '文件处理',
  keywords: ['compare', 'diff', 'column', '比对', '对比', '差异', '列', '粘贴', 'txt', 'csv'],

  mount({ root, api, actions }) {
    const state = {
      sources: {
        A: { mode: 'file', file: null, text: '', scan: null },
        B: { mode: 'file', file: null, text: '', scan: null },
      },
      delimiterId: 'tab',
      customDelimiter: '',
      column: 1,
      encoding: 'auto',
      ignoreCase: false,
      result: null,
      activeTab: 'onlyInA',
      filter: '',
    };

    let runSeq = 0;
    let runTimer = null;

    const hasData = (mark) => {
      const source = state.sources[mark];
      return source.mode === 'file' ? Boolean(source.file) : source.text.trim().length > 0;
    };

    function currentDelimiter() {
      if (state.delimiterId === 'custom') {
        if (!state.customDelimiter) return null;
        return unescapeDelimiter(state.customDelimiter);
      }
      return DELIMITER_PRESETS.find((preset) => preset.id === state.delimiterId).value;
    }

    // ------------------------------------------------------------ 状态栏
    const status = statusBar('两侧都填好数据后自动比对');
    const setStatus = status.set;

    // ------------------------------------------------------------ 执行
    function scheduleRun(delay = AUTO_RUN_DELAY) {
      clearTimeout(runTimer);
      runTimer = setTimeout(run, delay);
    }

    async function run() {
      const delimiter = currentDelimiter();
      if (delimiter === null) {
        setStatus('err', '请填写自定义分隔符');
        return;
      }

      if (!hasData('A') || !hasData('B')) {
        state.result = null;
        renderStats();
        renderResult();
        setStatus('', '两侧都填好数据后自动比对');
        return;
      }

      const seq = (runSeq += 1);
      setStatus('busy', '比对中…');

      try {
        const options = { delimiter, columnIndex: state.column - 1, trim: true };
        const [scanA, scanB] = await Promise.all([
          scanSource('A', options),
          scanSource('B', options),
        ]);

        if (seq !== runSeq) return; // 已有更新的请求，丢弃这次结果

        state.sources.A.scan = scanA;
        state.sources.B.scan = scanB;
        refreshSlot('A');
        refreshSlot('B');

        computeResult(scanA, scanB);
        renderStats();
        renderResult();

        const shortNote =
          scanA.shortLines + scanB.shortLines > 0
            ? `，另有 ${fmtNum(scanA.shortLines + scanB.shortLines)} 行列数不足已跳过`
            : '';
        setStatus(
          'ok',
          `A 唯一值 ${fmtNum(scanA.uniqueCount)} 个 · B 唯一值 ${fmtNum(scanB.uniqueCount)} 个${shortNote}`
        );
      } catch (err) {
        if (seq !== runSeq) return;
        state.result = null;
        renderStats();
        renderResult();
        setStatus('err', err?.message || '比对失败');
      }
    }

    function scanSource(mark, options) {
      const source = state.sources[mark];
      if (source.mode === 'file') {
        return api.scanColumn({
          ...options,
          encoding: state.encoding,
          filePath: source.file.path,
        });
      }
      return api.scanColumnText({ ...options, text: source.text });
    }

    function computeResult(scanA, scanB) {
      const keyOf = (value) => (state.ignoreCase ? value.toLowerCase() : value);

      const mapA = new Map();
      for (const value of scanA.values) {
        const key = keyOf(value);
        if (!mapA.has(key)) mapA.set(key, value);
      }
      const mapB = new Map();
      for (const value of scanB.values) {
        const key = keyOf(value);
        if (!mapB.has(key)) mapB.set(key, value);
      }

      const onlyInA = [];
      const inBoth = [];
      for (const [key, value] of mapA) {
        if (mapB.has(key)) inBoth.push(value);
        else onlyInA.push(value);
      }

      const onlyInB = [];
      for (const [key, value] of mapB) {
        if (!mapA.has(key)) onlyInB.push(value);
      }

      const allMap = new Map(mapA);
      for (const [key, value] of mapB) {
        if (!allMap.has(key)) allMap.set(key, value);
      }

      onlyInA.sort((x, y) => collator.compare(x, y));
      onlyInB.sort((x, y) => collator.compare(x, y));
      inBoth.sort((x, y) => collator.compare(x, y));
      const all = [...allMap.values()].sort((x, y) => collator.compare(x, y));

      state.result = { onlyInA, onlyInB, inBoth, all, scanA, scanB };
    }

    // ------------------------------------------------------------ 数据源槽位
    function makeSourceSlot(mark) {
      const source = state.sources[mark];

      const modeGroup = seg(
        SOURCE_MODES,
        source.mode,
        (id) => {
          if (source.mode === id) return;
          source.mode = id;
          renderBody();
          updateRunButton();
          scheduleRun(0);
        },
        'seg seg-sm'
      );

      const body = h('div');

      const textarea = h('textarea', {
        class: 'textarea slot-textarea',
        spellcheck: 'false',
        placeholder: '粘贴一列数据，每行一条；也可直接粘贴整张表，按分隔符取列',
      });

      const footText = h('span', {});
      const footRow = h('div', { class: 'slot-foot' }, [
        footText,
        h('div', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onClick: async () => {
              try {
                const text = await api.clipboard.readText();
                if (!text) {
                  setStatus('err', '剪贴板里没有文本');
                  return;
                }
                textarea.value = text;
                source.text = text;
                source.scan = null;
                updateFoot();
                updateRunButton();
                scheduleRun(0);
              } catch (err) {
                setStatus('err', `读取剪贴板失败：${err.message}`);
              }
            },
          },
          ['从剪贴板粘贴']
        ),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onClick: () => {
              textarea.value = '';
              source.text = '';
              source.scan = null;
              updateFoot();
              updateRunButton();
              scheduleRun(0);
              textarea.focus();
            },
          },
          ['清空']
        ),
      ]);

      textarea.addEventListener('input', () => {
        source.text = textarea.value;
        if (!source.text.trim()) source.scan = null;
        updateFoot();
        updateRunButton();
        scheduleRun();
      });

      const el = h('div', { class: 'file-slot' }, [
        h('div', { class: 'file-slot-head' }, [
          h('div', { class: 'file-slot-title' }, [`数据 ${mark}`]),
          modeGroup,
        ]),
        body,
      ]);

      async function chooseFile() {
        const filePath = await api.pickFile({
          title: `选择文件 ${mark}`,
          filters: [
            { name: '表格与文本', extensions: ['xlsx', 'xlsm', 'txt', 'csv', 'tsv', 'log', 'dat'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });
        if (!filePath) return;

        const name = await api.basename(filePath);
        let size = 0;
        try {
          const info = await api.stat(filePath);
          size = info.size;
        } catch {
          /* 拿不到大小不影响主流程 */
        }

        source.file = { path: filePath, name, size };
        source.scan = null;
        renderBody();
        updateRunButton();
        scheduleRun(0);
      }

      function buildFileRow() {
        const file = source.file;
        if (!file) {
          return h('div', { class: 'file-slot-body' }, [
            h('span', { class: 'file-empty' }, ['尚未选择文件']),
            h('div', { class: 'spacer' }),
            h('button', { class: 'btn btn-sm', onClick: chooseFile }, ['选择文件']),
          ]);
        }

        // 行数来自最近一次扫描结果，没扫过时只显示体积
        const rowCount = source.scan ? source.scan.totalLines : null;
        const kind = isSheetPath(file.name) ? '表格 · ' : '';
        const meta =
          rowCount === null
            ? `${kind}${formatBytes(file.size)}`
            : `${kind}${formatBytes(file.size)} · ${fmtNum(rowCount)} 行`;

        return h('div', { class: 'file-slot-body' }, [
          h('div', { style: { minWidth: '0' } }, [
            h('div', { class: 'file-name', title: file.path }, [file.name]),
            h('div', { class: 'hint' }, [meta]),
          ]),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', onClick: chooseFile }, ['更换']),
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              onClick: () => {
                source.file = null;
                source.scan = null;
                renderBody();
                updateRunButton();
                scheduleRun(0);
              },
            },
            ['清除']
          ),
        ]);
      }

      function updateFoot() {
        if (source.scan) {
          footText.textContent = `${fmtNum(source.scan.totalLines)} 行 · ${fmtNum(source.scan.uniqueCount)} 个唯一值`;
        } else if (source.text.trim()) {
          footText.textContent = '等待比对…';
        } else {
          footText.textContent = '支持 Ctrl+V 直接粘贴';
        }
      }

      function renderBody() {
        clear(body);
        el.classList.toggle('is-filled', hasData(mark));
        setSegValue(modeGroup, source.mode);

        if (source.mode === 'file') {
          body.append(buildFileRow());
          return;
        }

        if (textarea.value !== source.text) textarea.value = source.text;
        body.append(textarea, footRow);
        updateFoot();
      }

      function refresh() {
        // 文件模式的元信息（行数）变了要重建；粘贴模式只更新脚注，避免 textarea 被移动导致光标丢失
        if (source.mode === 'file') renderBody();
        else updateFoot();
      }

      renderBody();
      return { el, refresh };
    }

    const slotA = makeSourceSlot('A');
    const slotB = makeSourceSlot('B');
    const refreshSlot = (mark) => (mark === 'A' ? slotA : slotB).refresh();

    // ------------------------------------------------------------ 选项
    // 自定义分隔符：用 .opt-inline 包一层 + .input-sm（26px），
    // 出现时不会把整行撑高 2px（标准 .input 是 34px）
    const customWrap = h('div', { class: 'opt-inline', style: { display: 'none' } }, [
      h('input', {
        class: 'input input-sm',
        style: { width: '120px' },
        placeholder: '如 ; 或 \\t',
        onInput: (event) => {
          state.customDelimiter = event.target.value;
          persistConfig();
          scheduleRun();
        },
      }),
    ]);

    const delimGroup = seg(DELIMITER_PRESETS, state.delimiterId, (id) => {
      state.delimiterId = id;
      customWrap.style.display = id === 'custom' ? '' : 'none';
      persistConfig();
      scheduleRun(0);
    });

    // 一个「标签 + 它的控件」是不可拆的组：宽度够就并排，不够就整组换行
    const optItem = (label, children, labelClass = 'opt-label') =>
      h('div', { class: 'opt-item' }, [
        h('span', { class: labelClass }, [label]),
        ...children,
      ]);

    const columnInput = h('input', {
      class: 'input input-inline',
      type: 'number',
      min: '1',
      step: '1',
      value: '1',
      dataset: { role: 'column' },
      onInput: (event) => {
        const next = parseInt(event.target.value, 10);
        state.column = Number.isFinite(next) && next > 0 ? next : 1;
        persistConfig();
        scheduleRun();
      },
    });

    const encodingGroup = seg(ENCODINGS, state.encoding, (id) => {
      state.encoding = id;
      persistConfig();
      scheduleRun(0);
    });

    const ignoreCaseBox = h('input', {
      class: 'checkbox',
      type: 'checkbox',
      onChange: (event) => {
        state.ignoreCase = event.target.checked;
        persistConfig();
        scheduleRun(0);
      },
    });

    // 用 margin-left:auto 靠右，而不是插一个 .spacer：
    // 窄屏换行时按钮会跟着到下一行并保持右对齐，不会孤零零贴在左边
    const rerunBtn = h(
      'button',
      { class: 'btn btn-sm', style: { marginLeft: 'auto' }, onClick: () => run() },
      ['重新比对']
    );

    // ------------------------------------------------------------ 配置记忆
    // 只记选项，不记数据：粘贴内容本质是临时物，文件可能被移动/删除。
    // 下次打开时选项就位，数据自己再给。
    let touched = false; // persistConfig 只会被用户的操作触发，正好当「已动过」标记
    const persistConfig = debounce(() => {
      touched = true;
      try {
        api.settings
          .patchTool('column-compare', {
            delimiterId: state.delimiterId,
            customDelimiter: state.customDelimiter,
            column: state.column,
            encoding: state.encoding,
            ignoreCase: state.ignoreCase,
          })
          .catch(() => {});
      } catch {
        /* 设置通道不可用时不影响工具本身 */
      }
    }, 600);

    function applyConfigUI() {
      setSegValue(delimGroup, state.delimiterId);
      customWrap.style.display = state.delimiterId === 'custom' ? '' : 'none';
      customWrap.querySelector('input').value = state.customDelimiter;
      columnInput.value = String(state.column);
      setSegValue(encodingGroup, state.encoding);
      ignoreCaseBox.checked = state.ignoreCase;
    }

    // 选项变化都要在 UI 上有所反映，这里集中做「state → 界面」的同步，
    // 恢复历史配置和用户手点走的是同一条路
    api.settings
      .get()
      .then((settings) => {
        if (touched) return; // 用户已经先动了手，历史配置不作数
        const saved = settings?.tools?.['column-compare'];
        if (!saved) return;
        if (typeof saved.delimiterId === 'string') state.delimiterId = saved.delimiterId;
        if (typeof saved.customDelimiter === 'string') state.customDelimiter = saved.customDelimiter;
        if (Number.isFinite(saved.column) && saved.column > 0) state.column = saved.column;
        if (['auto', 'utf-8', 'gbk'].includes(saved.encoding)) state.encoding = saved.encoding;
        if (typeof saved.ignoreCase === 'boolean') state.ignoreCase = saved.ignoreCase;
        applyConfigUI();
      })
      .catch(() => {});

    function updateRunButton() {
      rerunBtn.disabled = !(hasData('A') && hasData('B'));
    }

    // ------------------------------------------------------------ 统计
    const statsEl = h('div', { class: 'stats', style: { display: 'none' } });

    function renderStats() {
      clear(statsEl);
      const result = state.result;
      if (!result) {
        statsEl.style.display = 'none';
        return;
      }

      const cards = [
        { label: 'A 唯一值', value: result.scanA.uniqueCount },
        { label: 'B 唯一值', value: result.scanB.uniqueCount },
        { label: 'A 有 B 没有', value: result.onlyInA.length, tone: 'is-danger' },
        { label: 'B 有 A 没有', value: result.onlyInB.length, tone: 'is-warn' },
        { label: '两者共有', value: result.inBoth.length, tone: 'is-accent' },
        { label: '合并去重', value: result.all.length },
      ];

      statsEl.style.display = '';
      for (const card of cards) {
        statsEl.append(
          h('div', { class: `stat${card.tone ? ` ${card.tone}` : ''}` }, [
            h('div', { class: 'stat-num' }, [fmtNum(card.value)]),
            h('div', { class: 'stat-lbl' }, [card.label]),
          ])
        );
      }
    }

    // ------------------------------------------------------------ 结果
    const resultEl = h('div', { style: { display: 'none' } });

    const EXPORT_NAMES = {
      onlyInA: 'A有B没有.txt',
      onlyInB: 'B有A没有.txt',
      inBoth: '两者共有.txt',
      all: '合并去重.txt',
    };

    const activeValues = () => (state.result ? state.result[state.activeTab] || [] : []);

    function filteredValues() {
      const keyword = state.filter.trim().toLowerCase();
      const values = activeValues();
      if (!keyword) return values;
      return values.filter((value) => value.toLowerCase().includes(keyword));
    }

    function renderResult() {
      clear(resultEl);
      if (!state.result) {
        resultEl.style.display = 'none';
        return;
      }
      resultEl.style.display = '';

      const tabs = h(
        'div',
        { class: 'tabs' },
        TABS.map((tab) =>
          h(
            'button',
            {
              class: `tab${tab.id === state.activeTab ? ' is-on' : ''}`,
              onClick: () => {
                state.activeTab = tab.id;
                renderResult();
              },
            },
            [
              tab.label,
              h('span', { class: 'tab-count' }, [
                fmtNum(state.result ? (state.result[tab.id] || []).length : 0),
              ]),
            ]
          )
        )
      );

      const filterInput = h('input', {
        class: 'input',
        style: { maxWidth: '240px' },
        placeholder: '在结果中筛选',
        value: state.filter,
        onInput: (event) => {
          state.filter = event.target.value;
          renderList();
        },
      });

      const copyBtn = h(
        'button',
        {
          class: 'btn btn-sm',
          onClick: async () => {
            const values = filteredValues();
            if (values.length === 0) return;
            await api.clipboard.writeText(values.join('\n'));
            const original = copyBtn.textContent;
            copyBtn.textContent = `已复制 ${fmtNum(values.length)} 条`;
            setTimeout(() => (copyBtn.textContent = original), 1400);
          },
        },
        ['复制']
      );

      const listEl = h('div', { class: 'data-list' });

      function renderList() {
        clear(listEl);
        const matched = filteredValues();

        if (matched.length === 0) {
          listEl.append(
            h('div', { class: 'list-empty' }, [
              state.filter ? '没有匹配筛选条件的数据' : '该分类为空（无差异）',
            ])
          );
          return;
        }

        const shown = matched.slice(0, DISPLAY_LIMIT);
        for (const value of shown) {
          listEl.append(h('div', { class: 'row' }, [value]));
        }

        if (matched.length > shown.length) {
          listEl.append(
            h('div', { class: 'list-empty' }, [
              `共 ${fmtNum(matched.length)} 条，此处仅显示前 ${fmtNum(shown.length)} 条；复制与导出包含全部数据。`,
            ])
          );
        }
      }

      renderList();

      resultEl.append(
        tabs,
        h('div', { class: 'toolbar', style: { marginTop: '10px' } }, [
          filterInput,
          h('span', { class: 'hint' }, [state.filter ? `筛选出 ${fmtNum(filteredValues().length)} 条` : '']),
          h('div', { class: 'spacer' }),
          copyBtn,
        ]),
        listEl
      );
    }

    // ------------------------------------------------------------ 组装
    // 文件类操作统一放顶栏（与 JSON / SQL IN 一致），列表内的复制留在列表上方
    const exportBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: async () => {
          const values = activeValues();
          if (values.length === 0) {
            setStatus('err', '当前分类没有数据可导出');
            return;
          }
          const saved = await api.saveText({
            title: '导出比对结果',
            defaultName: EXPORT_NAMES[state.activeTab] || 'result.txt',
            filters: [{ name: '文本文件', extensions: ['txt'] }],
            content: values.join('\r\n'),
          });
          if (saved) setStatus('ok', `已导出 ${fmtNum(values.length)} 条到 ${saved}`);
        },
      },
      ['导出本类全部']
    );

    actions.append(exportBtn);

    root.append(
      h('div', { class: 'split', style: { flex: 'none', alignItems: 'start' } }, [
        slotA.el,
        slotB.el,
      ]),
      // 与 SQL IN 一致的选项面板：一行一个设置，标签左对齐，右侧放内容级操作
      h('div', { class: 'card opt-panel' }, [
        h('div', { class: 'opt-group' }, [
          h('div', { class: 'opt-group-title' }, ['比对规则']),
          h('div', { class: 'opt-row' }, [
            optItem('分隔符', [delimGroup, customWrap]),
          ]),
          h('div', { class: 'opt-row' }, [
            optItem('取第几列', [columnInput]),
            optItem('编码', [encodingGroup], 'opt-label opt-label-sep'),
            h('div', { class: 'opt-item' }, [
              h('label', { class: 'check-label' }, [ignoreCaseBox, '忽略大小写']),
            ]),
            rerunBtn,
          ]),
        ]),
      ]),
      status.el,
      statsEl,
      resultEl,
      h('p', { class: 'hint' }, [
        '改数据或选项即时重算；xlsx/xlsm 按单元格读，忽略分隔符与编码；编码「自动」先试 UTF-8，不行再按 ANSI。',
      ])
    );

    updateRunButton();
  },
};
