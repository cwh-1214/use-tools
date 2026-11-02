import { h, debounce } from '../../core/dom.js';
import { toolbar, field, statusBar, copyButton, hintLine } from '../../core/ui.js';

const pad = (n, len = 2) => String(n).padStart(len, '0');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 本地时区偏移 + IANA 名称，跨时区对时间时很有用 */
function timezoneLabel(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)} · ${zone}`;
}

function relative(date) {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    [1000 * 60 * 60 * 24 * 365, '年'],
    [1000 * 60 * 60 * 24 * 30, '个月'],
    [1000 * 60 * 60 * 24, '天'],
    [1000 * 60 * 60, '小时'],
    [1000 * 60, '分钟'],
    [1000, '秒'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const value = Math.floor(abs / ms);
      return diff > 0 ? `${value} ${label}后` : `${value} ${label}前`;
    }
  }
  return '刚刚';
}

/** 支持 10 位（秒）/ 13 位（毫秒）/ 16 位（微秒）时间戳，以及常见日期字符串 */
function parseTimestamp(raw) {
  const text = raw.trim();
  if (!text) return null;

  if (/^-?\d+$/.test(text)) {
    const num = Number(text);
    const digits = text.replace('-', '').length;
    if (digits >= 16) return new Date(num / 1000);
    if (digits >= 13) return new Date(num);
    if (digits >= 10) return new Date(num * 1000);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// 本地日期串：2023-11-15 / 2023/11/15 / 2023年11月15日（可带时间与毫秒）
const LOCAL_DATE_RE =
  /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/;

// 带时区的 ISO：交给 Date 按偏移换算，不能再按本地时间拼
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 解析「日期时间」输入框里的文本，全部按本地时区理解。
 * 注意不能用 new Date('2023-11-15')：ISO 只有日期时会被当成 UTC，
 * 在东八区会变成前一天 08:00。这里统一手工拼本地时间。
 */
function parseDateText(raw) {
  const text = raw.trim();
  if (!text) return null;

  // 直接粘时间戳进来也认（10/13/16 位）
  if (/^-?\d{10,16}$/.test(text)) return parseTimestamp(text);

  if (ISO_WITH_ZONE_RE.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const m = text.match(LOCAL_DATE_RE);
  if (!m) return null;

  const [, y, mo, d, hh = '0', mi = '0', ss = '0', frac = '0'] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mi),
    Number(ss),
    Number(frac.padEnd(3, '0'))
  );

  // 2 月 30 日、25 点这类会「进位」到别的日期，回读校验挡住
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

export default {
  id: 'timestamp',
  name: '时间戳转换',
  desc: '秒 / 毫秒时间戳与日期互转，实时刷新，附相对时间',
  icon: 'ts',
  group: '文本与编码',
  keywords: ['timestamp', 'time', 'date', 'unix', '时间戳', '日期', '时间'],

  mount({ root, api }) {
    let ticking = false;
    let timer = null;
    let syncing = false;

    const tsInput = h('input', {
      class: 'input',
      placeholder: '10 位秒 / 13 位毫秒，也支持粘贴日期字符串',
      spellcheck: 'false',
    });

    // 普通文本框：粘贴什么就识别什么，不用系统日期选择器
    const dateInput = h('input', {
      class: 'input',
      dataset: { role: 'date' },
      placeholder: '粘贴：2023-11-15 06:13:20 / 2023/11/15 / ISO 8601',
      spellcheck: 'false',
    });

    const status = statusBar('—');

    // ------------------------------------------------------------ 结果行
    const rows = {};

    function makeRow(key, label, copyable) {
      const value = h('span', { class: 'kv-val' }, ['—']);
      const dd = h('dd', {}, [value]);

      if (copyable) {
        dd.append(
          copyButton(() => value.textContent, (text) => api.clipboard.writeText(text), {
            className: 'kv-copy',
          })
        );
      }

      rows[key] = value;
      return [h('dt', {}, [label]), dd];
    }

    const kv = h('dl', { class: 'kv' }, [
      ...makeRow('local', '本地时间', true),
      ...makeRow('utc', 'UTC', true),
      ...makeRow('iso', 'ISO 8601', true),
      ...makeRow('tz', '时区', false),
      ...makeRow('week', '星期', false),
      ...makeRow('rel', '相对现在', false),
      ...makeRow('sec', '秒', true),
      ...makeRow('ms', '毫秒', true),
    ]);

    function paint(date) {
      const valid = date instanceof Date && !Number.isNaN(date.getTime());
      if (!valid) {
        for (const el of Object.values(rows)) el.textContent = '—';
        status.set('err', '无法解析为有效时间');
        return;
      }

      rows.local.textContent = formatLocal(date);
      rows.utc.textContent = date.toUTCString();
      rows.iso.textContent = date.toISOString();
      rows.tz.textContent = timezoneLabel(date);
      rows.week.textContent = WEEKDAYS[date.getDay()];
      rows.rel.textContent = relative(date);
      rows.sec.textContent = String(Math.floor(date.getTime() / 1000));
      rows.ms.textContent = String(date.getTime());

      status.set('ok', '有效时间');
    }

    function fromTimestamp() {
      if (syncing) return;
      const date = parseTimestamp(tsInput.value);
      const valid = date instanceof Date && !Number.isNaN(date.getTime());
      paint(valid ? date : null);
      // 时间戳这边是源头，无效时把日期框清掉，避免显示上一次的值
      syncing = true;
      dateInput.value = valid ? formatLocal(date) : '';
      syncing = false;
    }

    // 日期框边打边解析，稍微防抖一下，避免半截文本一直闪错误态
    const fromDate = debounce(() => {
      if (syncing) return;
      const date = parseDateText(dateInput.value);
      const valid = date instanceof Date && !Number.isNaN(date.getTime());
      paint(valid ? date : null);
      syncing = true;
      tsInput.value = valid ? String(Math.floor(date.getTime() / 1000)) : '';
      syncing = false;
    }, 150);

    tsInput.addEventListener('input', fromTimestamp);
    dateInput.addEventListener('input', fromDate);

    // 失焦时把能解析的文本统一成标准写法，不能解析的原样留着方便改
    dateInput.addEventListener('blur', () => {
      const date = parseDateText(dateInput.value);
      if (date) dateInput.value = formatLocal(date);
    });

    function useNow() {
      const now = new Date();
      syncing = true;
      tsInput.value = String(Math.floor(now.getTime() / 1000));
      dateInput.value = formatLocal(now);
      syncing = false;
      paint(now);
    }

    const tickBtn = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          ticking = !ticking;
          tickBtn.classList.toggle('btn-primary', ticking);
          tickBtn.textContent = ticking ? '停止刷新' : '实时刷新';
          if (ticking) {
            useNow();
            timer = setInterval(useNow, 1000);
          } else if (timer) {
            clearInterval(timer);
            timer = null;
          }
        },
      },
      ['实时刷新']
    );

    const nowBtn = h('button', { class: 'btn btn-sm', onClick: useNow }, ['当前时间']);

    root.append(
      toolbar([tickBtn], [nowBtn]),
      // 两个输入并排；不能用 .split，那是给文本域撑满高度用的
      h('div', { class: 'input-grid' }, [
        field('时间戳', tsInput),
        field('日期时间（本地时区）', dateInput),
      ]),
      status.el,
      h('div', { class: 'card', style: { padding: '12px 16px' } }, [kv]),
      hintLine('时间戳自动识别 10 / 13 / 16 位；日期栏直接粘贴即可，只有日期时按当天 0 点算。')
    );

    useNow();

    return () => {
      if (timer) clearInterval(timer);
      tsInput.removeEventListener('input', fromTimestamp);
      dateInput.removeEventListener('input', fromDate);
    };
  },
};
