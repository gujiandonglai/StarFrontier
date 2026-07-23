/**
 * MathUtils.js
 * ------------------------------------------------------------------
 * 功能：跨模块共享的数学工具函数集合，避免在飞船物理/摄像机/程序生成
 *       中各自重复实现 clamp、lerp 等基础运算。
 * 输入：见每个函数签名
 * 输出：见每个函数签名
 * 调用关系：被 ship/PlayerShip.js、player/CameraRig.js、
 *           scene/Starfield.js 等多个模块引用
 * 复杂度：全部函数均为 O(1)
 * ------------------------------------------------------------------
 */

/**
 * 将数值限制在 [min, max] 区间内
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 线性插值
 * @param {number} a
 * @param {number} b
 * @param {number} t 0~1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 帧率无关的指数平滑插值（比固定 lerp 更适合追随摄像机/阻尼手感）
 * 参考公式：1 - e^(-speed * dt)，speed 越大跟随越紧
 * @param {number} current
 * @param {number} target
 * @param {number} speed
 * @param {number} dt
 * @returns {number}
 */
export function dampTowards(current, target, speed, dt) {
  const t = 1 - Math.exp(-speed * dt);
  return lerp(current, target, t);
}

/**
 * [min, max] 区间内的随机浮点数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randRange(min, max) {
  return min + Math.random() * (max - min);
}
