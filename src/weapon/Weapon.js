/**
 * Weapon.js
 * ------------------------------------------------------------------
 * 功能：飞船身上「一个武器挂点」的运行时实例。持有对应的 WeaponDef、
 *       开火冷却计时器，并暴露 tryFire()：调用方（WeaponSystem）每帧
 *       传入「是否按下开火键」，Weapon 自己根据 fireRate 判断这一帧
 *       是否真的能发射，避免每个调用方都要重复实现冷却计算。
 *       Phase6 起，tryFire() 额外接受一个可选的 EnergyCore：如果传入了
 *       就会在冷却允许开火的前提下再检查/扣减 def.energyCost，能量不够
 *       就不发射（也不会消耗冷却，下一帧只要能量够了可以立刻再试）。
 *       敌人 AI 调用 tryFire() 时不传 energyCore，继续无限开火——
 *       Phase6 的能源系统刻意只作用于玩家飞船，见 ship/EnergyCore.js
 *       顶部注释的说明。
 * 输入：
 *   - 构造：defId: string（对应 WeaponDefs 中的 id）
 *   - tryFire(dt, triggerHeld, energyCore?): boolean 是否应该在本帧发射
 * 输出：this.def（当前武器定义，可能因升级/改装而替换）
 * 调用关系：被 weapon/WeaponSystem.js 持有（一个飞船可挂载多个 Weapon）；
 *          被 ship/ShipLoadout.js 的 installWeapon() 调用 setDef() 换装
 * 复杂度：tryFire() 为 O(1)
 * ------------------------------------------------------------------
 */
import { getWeaponDef } from './WeaponDefs.js';

export class Weapon {
  /**
   * @param {string} defId WeaponDefs 中的武器 id
   * @param {string} [mountId] 挂点标识（例如 'primary'/'secondary'），用于 UI 显示
   */
  constructor(defId, mountId = 'primary') {
    this.mountId = mountId;
    this.def = getWeaponDef(defId);
    this._cooldownRemaining = 0;
  }

  /**
   * 升级/切换到另一个武器定义（对应升级树的 nextTierId，或玩家在改装界面更换武器）
   * @param {string} newDefId
   */
  setDef(newDefId) {
    this.def = getWeaponDef(newDefId);
  }

  /**
   * 每帧调用，推进冷却计时并判断本帧是否应该发射
   * @param {number} dt 秒
   * @param {boolean} triggerHeld 开火键是否按下
   * @param {import('../ship/EnergyCore.js').EnergyCore|null} [energyCore] 传入则会做能量判定，
   *        不传（如敌人 AI）则跳过能量限制，行为与 Phase2~5 完全一致
   * @returns {boolean} 是否应在本帧生成一枚弹丸
   */
  tryFire(dt, triggerHeld, energyCore = null) {
    this._cooldownRemaining = Math.max(0, this._cooldownRemaining - dt);
    if (!triggerHeld || this._cooldownRemaining > 0) return false;
    if (energyCore && !energyCore.consume(this.def.energyCost)) return false; // 能量不足：不发射，也不进入冷却

    this._cooldownRemaining = 1 / this.def.fireRate;
    return true;
  }

  /** 0~1，供 HUD 绘制冷却指示条 */
  get cooldownRatio() {
    const period = 1 / this.def.fireRate;
    return period > 0 ? 1 - this._cooldownRemaining / period : 1;
  }
}
