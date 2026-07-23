/**
 * ResourceDefs.js
 * ------------------------------------------------------------------
 * 功能：全局唯一的资源元数据表（id/中文名/颜色/稀有度权重/基准信用点价值）。
 *       这张表原本只在 planet/PlanetSurfaceGenerator.js 里给「挖矿掉落
 *       什么」用，Phase4 经济系统同样需要「这个资源值多少信用点」，
 *       如果两边各自维护一份资源列表，早晚会因为忘记同步而出现「地表
 *       挖到的矿物 ID 在市场里查不到价格」这类隐蔽 bug。因此把它提升为
 *       economy/ 下的共享数据表，挖矿与市场都从这里读取，保证只有一处
 *       事实来源（single source of truth）。
 * 输入：无（静态数据）
 * 输出：RESOURCE_TYPES 数组；getResourceDef(id)；pickWeightedResourceType(rng)
 * 调用关系：被 planet/PlanetSurfaceGenerator.js（挖矿掉落）与
 *           economy/Market.js（定价）共同引用
 * 复杂度：O(1)（pickWeightedResourceType 为 O(资源种类数)，当前 5 种）
 * ------------------------------------------------------------------
 */

/**
 * @typedef {Object} ResourceDef
 * @property {string} id
 * @property {string} name 中文显示名
 * @property {number} color 用于挖矿节点/UI 图标的颜色
 * @property {number} weight 挖矿时的稀有度权重（越大越常见）
 * @property {number} baseCreditValue 基准信用点单价，market 会在此基础上按供需浮动
 */

export const RESOURCE_TYPES = Object.freeze([
  { id: 'iron_ore', name: '铁矿', color: 0xb0522d, weight: 5, baseCreditValue: 8 },
  { id: 'titanium_ore', name: '钛矿', color: 0xc7d3dc, weight: 3, baseCreditValue: 18 },
  { id: 'rare_crystal', name: '稀有晶体', color: 0xb14bff, weight: 1.2, baseCreditValue: 65 },
  { id: 'helium3', name: '氦-3', color: 0x7dffb3, weight: 1.5, baseCreditValue: 45 },
  { id: 'ancient_relic', name: '古代遗迹', color: 0xffd700, weight: 0.4, baseCreditValue: 220 },
]);

const _byId = new Map(RESOURCE_TYPES.map((r) => [r.id, r]));

/**
 * @param {string} id
 * @returns {ResourceDef}
 */
export function getResourceDef(id) {
  const def = _byId.get(id);
  if (!def) throw new Error(`[ResourceDefs] 未知资源 ID: ${id}`);
  return def;
}

/**
 * 按 weight 加权随机挑选一种资源（越常见的矿物权重越大，越容易挖到）
 * @param {import('../utils/SeededRandom.js').SeededRandom} rng
 * @returns {ResourceDef}
 */
export function pickWeightedResourceType(rng) {
  const totalWeight = RESOURCE_TYPES.reduce((sum, r) => sum + r.weight, 0);
  let roll = rng.next() * totalWeight;
  for (const r of RESOURCE_TYPES) {
    if (roll < r.weight) return r;
    roll -= r.weight;
  }
  return RESOURCE_TYPES[RESOURCE_TYPES.length - 1];
}
