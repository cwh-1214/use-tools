/**
 * SQL IN 值转换的纯逻辑层。
 *
 * 刻意不依赖 DOM / window，因为这块规则最多、最容易出错（引号、全角逗号、
 * 括号外壳、数字判定…），必须能脱离界面单独测试。
 *
 * 处理流程：
 *   原始输入 → 剥掉 IN (...) / NOT IN (...) / VALUES (...) 外壳 → 按引号感知的规则切分
 *   → 去重 / 排序 → 按引号策略重新加引号 → 拼成目标格式
 */

/** 各分隔方式对应的字符集合（多字符分隔符也支持，按长度从长到短匹配） */
export const SEPARATOR_PRESETS = {
  // 自动是「不想选」时的兜底：换行、制表符、空格、逗号、竖线都认
  // （中文逗号「，」也算逗号）。注意空格也算，值里本身带空格时会被劈开，
  // 那种数据要改选「换行」。
  auto: ['\n', '\t', ' ', ',', '，', '|'],
  newline: ['\n'],
  tab: ['\t'],
  space: [' ', '\t'],
  comma: [',', '，'],
  pipe: ['|'],
  // 界面上下线了「分号」，这里保留给旧配置用（存着 semicolon 的用户仍能正常切分）
  semicolon: [';', '；'],
};

const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NULL_RE = /^null$/i;

/** 统一换行，避免 \r\n / \r 混在一起导致切分和计数不一致 */
export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

/** 界面里允许输入 \t \n 这类转义写法，避免用户打不出制表符 */
export function unescapeSeparator(raw) {
  return String(raw ?? '')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

/**
 * 去掉「外壳」：整条 SQL 片段、IN 关键字、外层圆括号、结尾分号。
 * 这样用户可以直接粘 `id NOT IN ('a','b')` 进来，不用手工清理。
 *
 * 返回：
 *   text        剥完外壳的纯值串
 *   stripped    是否真的剥掉了东西（用于界面提示，避免用户以为数据被篡改）
 *   negate      NOT IN → true / IN → false / 没识别到关键字 → null
 *   column      语句里带的列名（没识别到 → null）
 */
export function stripShell(text) {
  let out = String(text ?? '').trim();
  let stripped = false;
  let negate = null;
  let column = null;

  if (/;\s*$/.test(out)) {
    out = out.replace(/;\s*$/, '').trim();
    stripped = true;
  }

  // 带列名的形式：user_id NOT IN (...) —— 顺带把列名捞出来复用
  const withColumn = out.match(/^([A-Za-z_][\w.$]*)\s+(not\s+in|in)\s*(?=\()/i);
  if (withColumn) {
    column = withColumn[1];
    negate = /^not/i.test(withColumn[2]);
    out = out.slice(withColumn[0].length).trim();
    stripped = true;
  } else {
    // 裸关键字形式：IN (...) / NOT IN (...) / VALUES (...)
    const keyword = out.match(/^(not\s+in|in|values)\s*(?=\()/i);
    if (keyword) {
      negate = /^not/i.test(keyword[1]) ? true : /^in$/i.test(keyword[1]) ? false : null;
      out = out.slice(keyword[0].length).trim();
      stripped = true;
    }
  }

  if (out.startsWith('(') && out.endsWith(')')) {
    const inner = dropParensOutsideQuotes(out);
    if (inner !== null) {
      out = inner;
      stripped = true;
    }
  }

  return { text: out, stripped, negate, column };
}

/**
 * 去掉引号外的所有圆括号；括号不配对（说明不是外壳）时返回 null。
 * 引号内的括号是数据，必须原样保留，例如 ('a(1)','b')。
 */
function dropParensOutsideQuotes(text) {
  let depth = 0;
  let out = '';
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (text[i + 1] === quote) {
          out += text[i + 1];
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
      continue;
    }
    out += ch;
  }

  if (quote || depth !== 0) return null;
  return out;
}

/**
 * 按分隔符切分，但「引号内的分隔符不切」。
 * 这是与 split(',') 的关键差异：'A,B' 必须是一个值，不能被拆成两个。
 *
 * 同时处理：
 *   - 值两端的引号（'abc' / "abc" / `abc`）会被剥掉，避免重复加引号变成 ''abc''
 *   - SQL 转义的单引号（'O''Brien'）还原成 O'Brien
 *   - 值中间出现的引号原样保留（如 O'Brien 不会被当成引号起点）
 */
export function splitValues(text, separators) {
  const seps = separators.filter(Boolean).sort((a, b) => b.length - a.length);
  const out = [];
  let buf = '';
  let quote = null;
  let i = 0;

  const flush = () => {
    const value = buf.trim();
    if (value) out.push(value);
    buf = '';
  };

  while (i < text.length) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\' && i + 1 < text.length && (text[i + 1] === quote || text[i + 1] === '\\')) {
        buf += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        if (text[i + 1] === quote) {
          buf += quote;
          i += 2;
          continue;
        }
        quote = null;
        i += 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // 只有在「值还没开始」时才把引号当包裹符号，否则当普通字符
    if ((ch === "'" || ch === '"' || ch === '`') && buf.trim() === '') {
      buf = '';
      quote = ch;
      i += 1;
      continue;
    }

    const hit = seps.find((sep) => text.startsWith(sep, i));
    if (hit) {
      flush();
      i += hit.length;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

function chunk(list, size) {
  if (!size || size <= 0 || list.length <= size) return [list];
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

/**
 * 主入口：输入原始文本 + 选项，得到输出文本与统计。
 *
 * options:
 *   separatorId     auto / newline / comma / semicolon / tab / space / custom
 *   customSeparator 自定义分隔符（支持 \t 写法，允许多字符）
 *   mode            in-line / in-block / list / plain
 *   quote           single / double / none
 *   numericUnquoted 数字不加引号
 *   nullLiteral     null 输出为 NULL（不加引号）
 *   dedupe          去重
 *   sort            none / asc / desc
 *   negate          输出 NOT IN
 *   column          列名（可选，来自输入或界面）
 *   chunkSize       每 N 个值分一组（0 = 不分片）
 */
export function convert(rawInput, options = {}) {
  const opts = {
    separatorId: 'auto',
    customSeparator: '',
    mode: 'in-line',
    quote: 'single',
    numericUnquoted: true,
    nullLiteral: true,
    dedupe: true,
    sort: 'none',
    negate: false,
    column: '',
    chunkSize: 0,
    ...options,
  };

  const stats = { raw: 0, duplicates: 0, numeric: 0, text: 0, nulls: 0, chunks: 1 };
  const input = normalizeNewlines(rawInput).trim();
  if (!input) {
    return { text: '', values: [], formatted: [], stats, stripped: false, negateInInput: null, columnInInput: null };
  }

  const shell = stripShell(input);

  let separators;
  if (opts.separatorId === 'custom') {
    separators = [unescapeSeparator(opts.customSeparator)];
  } else {
    separators = SEPARATOR_PRESETS[opts.separatorId] || SEPARATOR_PRESETS.auto;
  }

  const tokens = splitValues(shell.text, separators);
  stats.raw = tokens.length;

  // 去重（保留首次出现顺序）
  let values = tokens;
  if (opts.dedupe) {
    const seen = new Set();
    values = [];
    for (const token of tokens) {
      if (seen.has(token)) {
        stats.duplicates += 1;
        continue;
      }
      seen.add(token);
      values.push(token);
    }
  }

  if (opts.sort === 'asc' || opts.sort === 'desc') {
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' });
    values = [...values].sort((a, b) => (opts.sort === 'asc' ? 1 : -1) * collator.compare(a, b));
  }

  const quoteChar = opts.quote === 'double' ? '"' : "'";
  const formatted = values.map((value) => {
    if (opts.nullLiteral && NULL_RE.test(value)) {
      stats.nulls += 1;
      return 'NULL';
    }
    if (opts.numericUnquoted && NUMERIC_RE.test(value)) {
      stats.numeric += 1;
      return value;
    }
    stats.text += 1;
    if (opts.quote === 'none') return value;
    return quoteChar + value.split(quoteChar).join(quoteChar + quoteChar) + quoteChar;
  });

  const column = (opts.column || shell.column || '').trim();
  const colPrefix = column ? `${column} ` : '';
  const inWord = opts.negate ? 'NOT IN ' : 'IN ';
  const joiner = `\n${opts.negate ? 'AND ' : 'OR '}`;
  const groups = chunk(formatted, Number(opts.chunkSize) || 0);
  stats.chunks = groups.length;

  let text = '';
  switch (opts.mode) {
    case 'in-block': {
      const blocks = groups.map(
        (group) => `${colPrefix}${inWord}(\n${group.map((v) => `  ${v}`).join(',\n')}\n)`
      );
      text = blocks.join(joiner);
      break;
    }
    case 'list':
      // 每行一个值，末尾带逗号：可以直接粘进已有 IN (...) 里
      text = formatted.map((v) => `${v},`).join('\n');
      break;
    case 'plain':
      text = values.join('\n');
      break;
    case 'in-line':
    default:
      text = groups
        .map((group) => `${colPrefix}${inWord}(${group.join(', ')})`)
        .join(joiner);
      break;
  }

  return {
    text,
    values,
    formatted,
    stats,
    stripped: shell.stripped,
    negateInInput: shell.negate,
    columnInInput: shell.column,
  };
}
