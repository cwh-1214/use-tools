/**
 * 工具注册表。
 * 作用只有一个：把「工具定义数组」变成「按分组排好、可搜索、可校验」的结构。
 * 工具的加载时机是随时随地的 —— 没有构建步骤，改完刷新窗口就生效。
 */

const REQUIRED_FIELDS = ['id', 'name', 'mount'];

/** 校验工具定义，早失败早报错，避免点了侧边栏才发现工具是空的 */
export function validateTools(tools) {
  const seen = new Set();
  const problems = [];

  for (const tool of tools) {
    for (const field of REQUIRED_FIELDS) {
      if (!tool || !tool[field]) {
        problems.push(`工具缺少必填字段 ${field}: ${JSON.stringify(tool?.id ?? tool)}`);
      }
    }
    if (tool?.id) {
      if (seen.has(tool.id)) problems.push(`工具 id 重复: ${tool.id}`);
      seen.add(tool.id);
    }
    if (typeof tool?.mount !== 'function') {
      problems.push(`工具 ${tool?.id} 的 mount 必须是函数`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`工具定义有问题:\n- ${problems.join('\n- ')}`);
  }
  return tools;
}

/** 按 group 聚合，group 缺失时归到「其他」。保持注册顺序，不打乱作者意图 */
export function groupTools(tools) {
  const groups = new Map();
  for (const tool of tools) {
    const group = tool.group || '其他';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(tool);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}

/** 匹配名称、描述、关键词，忽略大小写 */
export function filterTools(tools, keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  if (!q) return tools;

  return tools.filter((tool) => {
    const haystack = [tool.name, tool.desc, tool.group, ...(tool.keywords || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function findTool(tools, id) {
  return tools.find((tool) => tool.id === id) || null;
}
