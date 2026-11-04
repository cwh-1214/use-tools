/**
 * 统一悬停提示。
 *
 * 不用原生 title：要等一秒才出来，样式由系统决定（深色主题下是一块突兀的浅灰方块），
 * 长文案也没法控制换行。这里用 [data-tip] 属性 + 事件委托做一份轻量实现：
 * 延迟 350ms、跟随主题、贴着元素上方弹出，上方放不下自动翻到下方。
 *
 * 用法：元素上写 data-tip="一句话"，其余什么都不用管。
 * 没有需要解释的内容就不要挂——和按钮文字重复的提示等于噪音。
 */

const SHOW_DELAY = 350;
const GAP = 8; // 气泡与元素的间距
const EDGE = 10; // 距窗口边缘至少留这么多

let bubble = null;
let timer = null;
let active = null;
let initialized = false;

function ensureBubble() {
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'tip-bubble';
    document.body.append(bubble);
  }
  return bubble;
}

function hide() {
  clearTimeout(timer);
  timer = null;
  active = null;
  if (bubble) bubble.classList.remove('is-on');
}

function place(target) {
  const el = ensureBubble();
  el.textContent = target.dataset.tip;
  el.classList.add('is-on');

  const box = target.getBoundingClientRect();
  const size = el.getBoundingClientRect();

  let top = box.top - size.height - GAP;
  if (top < EDGE) top = box.bottom + GAP; // 上方不够就翻到下方

  let left = box.left + box.width / 2 - size.width / 2;
  left = Math.max(EDGE, Math.min(left, window.innerWidth - size.width - EDGE));

  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

export function initTooltip() {
  if (initialized) return;
  initialized = true;

  // 委托到 document：工具页是动态挂载的，逐个绑事件既啰嗦又容易漏
  document.addEventListener('mouseover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (!target || target === active) return;
    hide();
    active = target;
    timer = setTimeout(() => {
      if (active === target && target.isConnected) place(target);
    }, SHOW_DELAY);
  });

  document.addEventListener('mouseout', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (!target) return;
    // 移到自己的子元素上不算离开
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    hide();
  });

  // 滚动和缩放时元素会移位，直接收起比重新算位置更省事
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}
