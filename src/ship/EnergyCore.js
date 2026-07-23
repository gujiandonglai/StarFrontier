/**
 * EnergyCore.js
 * ------------------------------------------------------------------
 * 功能：飞船的能量电容组件。武器开火消耗能量（WeaponDefs.energyCost），
 *       能量不足时无法开火——这是 weapon/Weapon.js 早在 Phase2 就预留好
 *       的"目前仅记录，Phase6 能源系统接入后生效"的那个 energyCost 字段
 *       第一次真正派上用场。能量随时间自动回充，回充速度与容量上限
 *       受反应堆模块影响（见 ship/ModuleDefs.js 的 reactor 类目）。
 *       只有玩家飞船持有 EnergyCore——敌人 AI 不需要这层复杂度、继续
 *       无限开火，这是 Phase6"专注玩家改装体验"的刻意范围收窄，
 *       并不是遗漏（否则每个敌人都要单独调好能量数值才能不显得又蠢
 *       又弱，投入产出比很低）。
 * 输入：构造 { maxEnergy, regenPerSecond }；consume(amount)；update(dt)
 * 输出：this.current（当前能量，供 HUD/武器开火判定读取）；ratio 只读属性
 * 调用关系：被 ship/PlayerShip.js 持有；被 weapon/Weapon.js 的
 *          tryFire() 在开火判定时读取/扣减；被 ship/ShipLoadout.js
 *          在安装反应堆模块时调整 maxEnergy/regenPerSecond
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
export class EnergyCore {
  /** @param {{maxEnergy?:number, regenPerSecond?:number}} [config] */
  constructor({ maxEnergy = 100, regenPerSecond = 10 } = {}) {
    this.maxEnergy = maxEnergy;
    this.regenPerSecond = regenPerSecond;
    this.current = maxEnergy;
  }

  /**
   * 尝试消耗能量，余量不足时不扣减并返回 false
   * @param {number} amount
   * @returns {boolean} 是否成功扣减（0 或负数视为总是成功，武器 energyCost 不会是负数，
   *          这里的判断只是防御性处理）
   */
  consume(amount) {
    if (amount <= 0) return true;
    if (this.current < amount) return false;
    this.current -= amount;
    return true;
  }

  /** @param {number} dt 秒 */
  update(dt) {
    if (this.current < this.maxEnergy) {
      this.current = Math.min(this.maxEnergy, this.current + this.regenPerSecond * dt);
    }
  }

  get ratio() {
    return this.maxEnergy > 0 ? this.current / this.maxEnergy : 0;
  }
}
