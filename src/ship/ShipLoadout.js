/**
 * ShipLoadout.js
 * ------------------------------------------------------------------
 * 功能：玩家飞船的模块化改装状态机（对应需求文档「五、飞船系统」的
 *       核心诉求："玩家不是升级数值，而是组装飞船"）。管理引擎/装甲/
 *       护盾/反应堆/主武器/副武器六个槽位当前装的是什么。
 *       数值类槽位（引擎/装甲/护盾/反应堆）安装新模块时，先撤销旧模块
 *       的数值加成，再应用新模块的加成——保证换装不会"叠加"效果（换一次
 *       装甲不会把新旧两块的加成都算上）。所有加成都作用在
 *       ShipPhysics/Health/EnergyCore 的实例字段上，和 Phase5
 *       TechTreeSystem 是同一套安全模式（这些字段是每个实例独立持有的，
 *       不是共享配置），区别只在于 Phase5 是永久单向加成，这里是
 *       可撤销的双向切换。
 *       武器槽位（主武器/副武器）不走加成机制，而是直接调用
 *       weapon/Weapon.js 早在 Phase2 就写好的 setDef() 整体替换弹道
 *       数据——武器本来就是"整体换一件"而非"数值叠加"的东西。
 * 输入：
 *   - 构造：{ playerShip }
 *   - install(slot, moduleDef)：安装数值类模块（engine/armor/shield/reactor）
 *   - installWeapon(slot, weaponDef)：安装武器（primaryWeapon/secondaryWeapon）
 * 输出：this.installed：{ engine, armor, shield, reactor } -> 当前 ModuleDef
 *       this.installedWeaponIds：{ primaryWeapon, secondaryWeapon } -> WeaponDef.id
 * 调用关系：由 ship/PlayerShip.js 在构造函数末尾创建（此时 physics/
 *          health/energyCore/weaponSystem 均已就绪）；改装面板 UI
 *          调用 install()/installWeapon()
 * 复杂度：install()/installWeapon() 均为 O(1)
 * ------------------------------------------------------------------
 */
import { MODULE_DEFS } from './ModuleDefs.js';

const STAT_SLOTS = ['engine', 'armor', 'shield', 'reactor'];

export class ShipLoadout {
  /** @param {object} deps @param {import('./PlayerShip.js').PlayerShip} deps.playerShip */
  constructor({ playerShip }) {
    this.playerShip = playerShip;

    /** @type {Record<string, import('./ModuleDefs.js').ModuleDef>} */
    this.installed = {};
    /** @type {Record<'primaryWeapon'|'secondaryWeapon', string|null>} */
    this.installedWeaponIds = { primaryWeapon: null, secondaryWeapon: null };

    // 初始状态就是每个槽位的 tier1 标准件（effect 全空），保证 installed
    // 从一开始就指向一个真实的 ModuleDef 而不是 null——"标准件"本身
    // 就是免费基线，不需要特殊处理"还没装东西"这种状态
    for (const slot of STAT_SLOTS) {
      this.installed[slot] = MODULE_DEFS[slot][0];
    }

    // 记录出厂武器 id，供改装面板判断"这个已经装着了，禁用安装按钮"
    const primaryMount = playerShip.weaponSystem.mounts.find((m) => m.triggerId === 'primary');
    const secondaryMount = playerShip.weaponSystem.mounts.find((m) => m.triggerId === 'secondary');
    this.installedWeaponIds.primaryWeapon = primaryMount ? primaryMount.weapon.def.id : null;
    this.installedWeaponIds.secondaryWeapon = secondaryMount ? secondaryMount.weapon.def.id : null;
  }

  /**
   * 安装数值类模块（引擎/装甲/护盾/反应堆）
   * @param {'engine'|'armor'|'shield'|'reactor'} slot
   * @param {import('./ModuleDefs.js').ModuleDef} moduleDef
   */
  install(slot, moduleDef) {
    const current = this.installed[slot];
    if (current) this._applyDeltaEffect(current.effect, -1);
    this._applyDeltaEffect(moduleDef.effect, 1);
    this.installed[slot] = moduleDef;
  }

  /**
   * 安装武器（主武器/副武器），直接替换弹道数据，不涉及数值叠加
   * @param {'primaryWeapon'|'secondaryWeapon'} slot
   * @param {import('../weapon/WeaponDefs.js').WeaponDef} weaponDef
   */
  installWeapon(slot, weaponDef) {
    const triggerId = slot === 'primaryWeapon' ? 'primary' : 'secondary';
    const mount = this.playerShip.weaponSystem.mounts.find((m) => m.triggerId === triggerId);
    if (!mount) return;
    mount.weapon.setDef(weaponDef.id);
    this.installedWeaponIds[slot] = weaponDef.id;
  }

  /**
   * 按统一 schema 把一个模块的数值加成应用/撤销到飞船各组件上
   * @param {import('./ModuleDefs.js').ModuleEffect} effect
   * @param {1|-1} sign 1 = 应用，-1 = 撤销
   */
  _applyDeltaEffect(effect, sign) {
    if (!effect) return;
    const physics = this.playerShip.physics;
    const health = this.playerShip.health;
    const energyCore = this.playerShip.energyCore;

    if (effect.maxSpeedMultiplierDelta) {
      physics.maxSpeedMultiplier += sign * effect.maxSpeedMultiplierDelta;
    }
    if (effect.maxHullDelta) {
      this._applyClampedDelta(health, 'maxHull', 'hull', sign * effect.maxHullDelta);
    }
    if (effect.maxShieldDelta) {
      this._applyClampedDelta(health, 'maxShield', 'shield', sign * effect.maxShieldDelta);
    }
    if (effect.shieldRegenDelta) {
      health.shieldRegenPerSecond += sign * effect.shieldRegenDelta;
    }
    if (effect.maxEnergyDelta) {
      this._applyClampedDelta(energyCore, 'maxEnergy', 'current', sign * effect.maxEnergyDelta);
    }
    if (effect.energyRegenDelta) {
      energyCore.regenPerSecond += sign * effect.energyRegenDelta;
    }
  }

  /**
   * 同步调整"上限"与"当前值"，并把当前值钳制在 [0, 新上限] 区间内。
   * 例如强化装甲 +40 上限时，当前装甲也同步 +40（不需要"回血"到新上限
   * 才算数）；卸下强化装甲时上限 -40，若当前装甲此时超过新上限会被
   * 钳制下来——拆装甲当然会让船更脆弱，这是合理的代价，不是 bug。
   */
  _applyClampedDelta(component, maxKey, currentKey, delta) {
    component[maxKey] = Math.max(1, component[maxKey] + delta);
    component[currentKey] = Math.min(component[maxKey], Math.max(0, component[currentKey] + delta));
  }
}
