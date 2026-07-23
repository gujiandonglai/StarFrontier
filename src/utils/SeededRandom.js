/**
 * SeededRandom.js
 * ------------------------------------------------------------------
 * 功能：确定性伪随机数生成器（mulberry32 算法）。程序生成的银河要求
 *       「同一颗种子在同一坐标必须生成完全相同的内容」——玩家离开某个
 *       扇区再飞回来，星球位置/资源/危险不能变化，否则穿帮；同一颗
 *       行星反复降落，地形与矿点分布也必须一致。Math.random() 不接受
 *       种子，因此自实现一个轻量确定性 PRNG。每个扇区/行星会用
 *       「全局种子 + 坐标哈希」派生出独立实例，互不干扰。
 * 输入：seed: number（会被转换为 32 位无符号整数）
 * 输出：next()/range()/int()/pick()/chance() 等便捷方法
 * 调用关系：被 galaxy/generation/GalaxyGenerator.js、galaxy/CelestialBodyFactory.js、
 *           utils/NoiseUtils.js、planet/PlanetSurfaceGenerator.js 使用
 * 复杂度：所有方法均为 O(1)
 * ------------------------------------------------------------------
 */
export class SeededRandom {
  /** @param {number} seed */
  constructor(seed) {
    this._state = seed >>> 0;
  }

  /** [0,1) 均匀分布，标准 mulberry32 实现 */
  next() {
    this._state |= 0;
    this._state = (this._state + 0x6d2b79f5) | 0;
    let t = Math.imul(this._state ^ (this._state >>> 15), 1 | this._state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 浮点数 */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** [min, maxInclusive] 整数 */
  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  /** 从数组中等概率随机取一项 */
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  /** 以给定概率返回 true */
  chance(probability) {
    return this.next() < probability;
  }
}

/**
 * 把任意整数坐标（例如扇区坐标 sx, sz）与全局种子混合成一个新的 32 位种子。
 * 使用简单的乘法哈希（类 FNV/Knuth 风格），不同坐标大概率产生不相关的种子，
 * 且对坐标符号（正负）不敏感——星系可以向银河四个方向无限延伸。
 * @param {number} globalSeed
 * @param {...number} coords
 * @returns {number}
 */
export function hashSeed(globalSeed, ...coords) {
  let h = globalSeed >>> 0;
  for (const c of coords) {
    h ^= Math.imul(c | 0, 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
