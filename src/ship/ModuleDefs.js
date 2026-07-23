/**
 * ModuleDefs.js
 * ------------------------------------------------------------------
 * 功能：飞船改装模块的数据表（对应需求文档「五、飞船系统」的引擎/装甲/
 *       护盾/能源核心几项）。每个模块的 effect 使用统一的「数值增量」
 *       schema（maxSpeedMultiplierDelta / maxHullDelta / maxShieldDelta /
 *       shieldRegenDelta / maxEnergyDelta / energyRegenDelta），这样
 *       ship/ShipLoadout.js 的安装/卸下逻辑可以用同一段通用代码处理
 *       全部四个槽位，不需要为每个槽位单独写"装备这个会怎样"的分支——
 *       新增模块只需要在这张表里加条目，不用碰 ShipLoadout。
 *       每个槽位的第一项（tier 1）都是「出厂标配」，effect 全空、
 *       cost 为 0，代表飞船出厂时已经装好，不能购买也不需要卸下
 *       （商店 UI 只会展示 tier ≥ 2 的条目）。
 *       装甲越厚会拖慢速度（maxSpeedMultiplierDelta 为负）——这是
 *       需求文档「不同组合：影响速度/质量/能耗/护盾/操控/输出」里
 *       明确要求的取舍关系，不是随便加的数值。
 * 输入：无（静态数据）
 * 输出：MODULE_DEFS：{ engine, armor, shield, reactor } -> ModuleDef[]
 * 调用关系：被 ship/ShipLoadout.js 引用；main.js 的改装面板 UI 遍历
 *           展示可购买的模块
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

/**
 * @typedef {Object} ModuleEffect
 * @property {number} [maxSpeedMultiplierDelta]
 * @property {number} [maxHullDelta]
 * @property {number} [maxShieldDelta]
 * @property {number} [shieldRegenDelta]
 * @property {number} [maxEnergyDelta]
 * @property {number} [energyRegenDelta]
 */

/**
 * @typedef {Object} ModuleDef
 * @property {string} id
 * @property {string} name
 * @property {number} tier
 * @property {number} cost 信用点价格，tier1 标配恒为 0
 * @property {ModuleEffect} effect
 * @property {string} description
 */

export const MODULE_DEFS = Object.freeze({
  engine: [
    { id: 'engine_standard', name: '标准引擎', tier: 1, cost: 0, effect: {}, description: '出厂标配引擎，性能均衡。' },
    { id: 'engine_high_speed', name: '高速引擎', tier: 2, cost: 800, effect: { maxSpeedMultiplierDelta: 0.2 }, description: '牺牲部分结构强度换取推力，最大速度 +20%。' },
    { id: 'engine_ftl_lite', name: '超光速引擎（民用简化版）', tier: 3, cost: 2200, effect: { maxSpeedMultiplierDelta: 0.4 }, description: '压缩化折跃引擎的民用简化版本，最大速度 +40%。' },
  ],
  armor: [
    { id: 'armor_standard', name: '标准装甲', tier: 1, cost: 0, effect: {}, description: '出厂标配装甲板。' },
    { id: 'armor_reinforced', name: '强化装甲板', tier: 2, cost: 700, effect: { maxHullDelta: 40, maxSpeedMultiplierDelta: -0.05 }, description: '船体上限 +40，但增重导致最大速度 -5%。' },
    { id: 'armor_composite', name: '复合装甲', tier: 3, cost: 1900, effect: { maxHullDelta: 90, maxSpeedMultiplierDelta: -0.1 }, description: '船体上限 +90，最大速度 -10%。' },
  ],
  shield: [
    { id: 'shield_standard', name: '标准护盾发生器', tier: 1, cost: 0, effect: {}, description: '出厂标配护盾发生器。' },
    { id: 'shield_capacitor', name: '强化电容护盾', tier: 2, cost: 750, effect: { maxShieldDelta: 25, shieldRegenDelta: 2 }, description: '护盾上限 +25，每秒回充速度 +2。' },
    { id: 'shield_barrier', name: '相位屏障护盾', tier: 3, cost: 2000, effect: { maxShieldDelta: 55, shieldRegenDelta: 5 }, description: '护盾上限 +55，每秒回充速度 +5。' },
  ],
  reactor: [
    { id: 'reactor_standard', name: '标准反应堆', tier: 1, cost: 0, effect: {}, description: '出厂标配能源核心。' },
    { id: 'reactor_overcharged', name: '超载反应堆', tier: 2, cost: 650, effect: { maxEnergyDelta: 40, energyRegenDelta: 6 }, description: '能量上限 +40，每秒回充速度 +6。' },
    { id: 'reactor_antimatter', name: '反物质核心', tier: 3, cost: 1800, effect: { maxEnergyDelta: 90, energyRegenDelta: 12 }, description: '能量上限 +90，每秒回充速度 +12。' },
  ],
});

/**
 * @param {string} slot 'engine'|'armor'|'shield'|'reactor'
 * @param {string} id
 * @returns {ModuleDef}
 */
export function getModuleDef(slot, id) {
  const def = (MODULE_DEFS[slot] || []).find((m) => m.id === id);
  if (!def) throw new Error(`[ModuleDefs] 未知模块: ${slot}/${id}`);
  return def;
}
