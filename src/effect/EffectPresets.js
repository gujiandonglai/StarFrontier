/**
 * EffectPresets.js
 * ------------------------------------------------------------------
 * 功能：命名的粒子爆发预设表，供 EffectManager 在响应战斗事件时查表
 *       使用，避免把「爆炸该有多少粒子/多快/多久」这类美术调优参数
 *       硬编码进事件处理逻辑里。
 * 输入：无（静态数据）
 * 输出：EffectPresets 具名导出对象
 * 调用关系：被 effect/EffectManager.js 引用
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
export const EffectPresets = {
  MUZZLE_FLASH: {
    count: 6,
    speedRange: [4, 10],
    lifeRange: [0.08, 0.16],
    spread: 0.15, // 集中朝前喷射，模拟枪口焰
  },
  PROJECTILE_IMPACT: {
    count: 14,
    speedRange: [8, 22],
    lifeRange: [0.2, 0.45],
    spread: 1,
  },
  SHIP_EXPLOSION: {
    count: 140,
    speedRange: [12, 60],
    lifeRange: [0.5, 1.4],
    spread: 1,
  },
};
