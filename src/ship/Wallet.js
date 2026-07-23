/**
 * Wallet.js
 * ------------------------------------------------------------------
 * 功能：玩家飞船的信用点（Credits）钱包组件。需求文档明确要求「金币
 *       改成信用点」，这里就是那个信用点账本。和 Health/CargoHold 一样
 *       采用组合而非继承挂在 PlayerShip 上——Phase5 的阵营声望、Phase9
 *       的舰队管理只需要读写这个对象，不需要关心信用点是怎么赚到的。
 * 输入：构造 startingCredits: number；addCredits(amount)；spendCredits(amount)
 * 输出：credits: number 只读快照（通过属性直接读取）
 * 调用关系：被 ship/PlayerShip.js 持有；被 economy/Market.js 与
 *           station/DockingController.js（维修等服务消费）读写
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
export class Wallet {
  /** @param {number} [startingCredits] */
  constructor(startingCredits = 500) {
    this.credits = Math.max(0, Math.round(startingCredits));
  }

  /** @param {number} amount */
  addCredits(amount) {
    if (amount <= 0) return;
    this.credits += Math.round(amount);
  }

  /**
   * 尝试花费信用点，余额不足时不扣款并返回 false
   * @param {number} amount
   * @returns {boolean} 是否成功扣款
   */
  spendCredits(amount) {
    const cost = Math.round(amount);
    if (cost <= 0) return true;
    if (this.credits < cost) return false;
    this.credits -= cost;
    return true;
  }
}
