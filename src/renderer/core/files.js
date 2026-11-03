/**
 * 文件类型判断：导入前先按扩展名拦一道，避免把 xlsx 这类二进制文件塞进文本工具，
 * 读出来是一堆乱码或者直接报编码错误。
 */

/** 取扩展名（小写、不含点）；没有扩展名返回空串 */
export function fileExtension(name) {
  const match = /\.([^.\\/]+)$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

export function isAllowedFile(name, extensions) {
  return extensions.includes(fileExtension(name));
}

/** 提示文案用：['json','txt'] → ".json / .txt" */
export function extensionList(extensions) {
  return extensions.map((ext) => `.${ext}`).join(' / ');
}
