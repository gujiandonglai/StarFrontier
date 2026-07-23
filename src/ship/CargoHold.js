/**
 * CargoHold.js
 * ------------------------------------------------------------------
 * 功能：玩家飞船的资源货舱组件。与 Health 一样采用组合而非继承的方式
 *       挂在 PlayerShip 上。Phase3 只负责「装得下多少、装了什么」，
 *       买卖/运输路线属于 Phase4 经济系统的范畴——那时经济系统只需要
 *       读写这个类，不需要关心资源是怎么采到的。
 * 输入：构造 capacity: number；addResource(resourceId, amount)
 * 输出：contents: Map<string, number>；totalStored 只读属性
 * 调用关系：被 ship/PlayerShip.js 持有；被 planet/LandingController.js
 *           在采矿成功时调用 addResource()
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
export class CargoHold {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    /** @type {Map<string, number>} */
    this.contents = new Map();
  }

  get totalStored() {
    let sum = 0;
    for (const amount of this.contents.values()) sum += amount;
    return sum;
  }

  /**
   * 尝试装入资源，超出容量的部分会被丢弃（返回值里如实报告）
   * @param {string} resourceId
   * @param {number} amount
   * @returns {{accepted:number, overflowed:number}}
   */
  addResource(resourceId, amount) {
    const spaceLeft = Math.max(0, this.capacity - this.totalStored);
    const accepted = Math.min(spaceLeft, amount);
    if (accepted > 0) {
      this.contents.set(resourceId, (this.contents.get(resourceId) || 0) + accepted);
    }
    return { accepted, overflowed: amount - accepted };
  }

  /**
   * 移除资源（用于出售等场景），最多移除到持有量为 0，不会变成负数
   * @param {string} resourceId
   * @param {number} amount
   * @returns {number} 实际移除的数量
   */
  removeResource(resourceId, amount) {
    const held = this.contents.get(resourceId) || 0;
    const removed = Math.min(held, amount);
    if (removed <= 0) return 0;
    const remaining = held - removed;
    if (remaining > 0) this.contents.set(resourceId, remaining);
    else this.contents.delete(resourceId);
    return removed;
  }
}
