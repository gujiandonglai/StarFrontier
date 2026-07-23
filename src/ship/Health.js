/**
 * Health.js
 * ------------------------------------------------------------------
 * 功能：飞船的生命值/护盾组件。护盾优先吸收伤害，护盾耗尽后伤害才会
 *       扣减装甲值；护盾在一段时间不受伤害后自动回充。通过 EventBus
 *       广播 'combat:damaged' 与 'combat:destroyed' 事件，UI（HUD 血条）
 *       与特效系统（爆炸/受损烟雾）都监听这些事件，不直接依赖 Health
 *       类本身，保持解耦。
 * 输入：
 *   - 构造：{ maxHull, maxShield, shieldRegenPerSecond, shieldRegenDelay, eventBus, ownerId, ownerTag }
 *   - takeDamage(amount, source)
 *   - update(dt) 驱动护盾回充计时
 * 输出：this.hull, this.shield（当前值，供 HUD 直接读取）
 * 调用关系：被 ship/PlayerShip.js、enemy/EnemyShip.js 持有；
 *           被 physics/CollisionSystem.js 在检测到武器命中时调用 takeDamage
 * 复杂度：update()/takeDamage() 均为 O(1)
 * ------------------------------------------------------------------
 */
let _nextEntityId = 1;

export class Health {
  /**
   * @param {object} config
   * @param {number} config.maxHull 装甲/船体上限
   * @param {number} [config.maxShield] 护盾上限，默认 0（无护盾）
   * @param {number} [config.shieldRegenPerSecond] 护盾每秒回充量
   * @param {number} [config.shieldRegenDelay] 受伤后多少秒才开始回充护盾
   * @param {import('../core/EventBus.js').EventBus} config.eventBus
   * @param {'player'|'enemy'|'npc'} config.ownerTag 阵营/身份标签，供碰撞过滤与 UI 使用
   */
  constructor(config) {
    this.entityId = _nextEntityId++;
    this.maxHull = config.maxHull;
    this.maxShield = config.maxShield ?? 0;
    this.shieldRegenPerSecond = config.shieldRegenPerSecond ?? 0;
    this.shieldRegenDelay = config.shieldRegenDelay ?? 4;
    this.eventBus = config.eventBus ?? null;
    this.ownerTag = config.ownerTag ?? 'unknown';

    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.isDestroyed = false;
    this._timeSinceLastHit = Infinity;
  }

  /**
   * 承受伤害。护盾优先吸收，护盾不足部分穿透到装甲。
   * @param {number} amount 伤害量（正数）
   * @param {{sourceEntityId?: number, sourceTag?: string, worldPosition?: import('three').Vector3}} [source]
   */
  takeDamage(amount, source = {}) {
    if (this.isDestroyed || amount <= 0) return;

    this._timeSinceLastHit = 0;

    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      this.hull = Math.max(0, this.hull - remaining);
    }

    this.eventBus?.emit('combat:damaged', {
      entityId: this.entityId,
      ownerTag: this.ownerTag,
      amount,
      hull: this.hull,
      shield: this.shield,
      worldPosition: source.worldPosition,
      sourceEntityId: source.sourceEntityId,
      sourceTag: source.sourceTag,
    });

    if (this.hull <= 0 && !this.isDestroyed) {
      this.isDestroyed = true;
      this.eventBus?.emit('combat:destroyed', {
        entityId: this.entityId,
        ownerTag: this.ownerTag,
        worldPosition: source.worldPosition,
        sourceEntityId: source.sourceEntityId,
        sourceTag: source.sourceTag,
      });
    }
  }

  /**
   * 修复装甲值（不会超过 maxHull），供 Phase4 空间站维修服务使用。
   * 不会复活已阵亡的实体——那需要走 Phase7 的重生流程，不是简单加血能解决的。
   * @param {number} amount
   */
  repairHull(amount) {
    if (this.isDestroyed || amount <= 0) return;
    this.hull = Math.min(this.maxHull, this.hull + amount);
  }

  /**
   * 每帧更新护盾回充计时。dt 累加到 _timeSinceLastHit，
   * 超过 shieldRegenDelay 后开始以 shieldRegenPerSecond 的速率回充。
   * @param {number} dt 秒
   */
  update(dt) {
    if (this.isDestroyed) return;
    this._timeSinceLastHit += dt;
    if (
      this.shield < this.maxShield &&
      this._timeSinceLastHit >= this.shieldRegenDelay
    ) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenPerSecond * dt);
    }
  }

  get hullRatio() {
    return this.maxHull > 0 ? this.hull / this.maxHull : 0;
  }

  get shieldRatio() {
    return this.maxShield > 0 ? this.shield / this.maxShield : 0;
  }
}
