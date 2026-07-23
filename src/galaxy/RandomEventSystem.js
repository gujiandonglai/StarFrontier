/**
 * RandomEventSystem.js
 * ------------------------------------------------------------------
 * 功能：需求文档「十七、随机事件」要求的银河随机事件。每隔一段随机
 *       间隔，在玩家当前所在扇区触发一个加权随机挑选的事件类型：
 *         - 空间风暴（spaceStorm）：持续一段时间，飞船机动性下降
 *         - 海盗突袭（pirateRaid）：额外一波敌人逼近
 *         - 残骸发现（derelictFound）：截获一段有价值的坐标情报
 *       完整实现需求文档列出的全部类型（超新星/黑洞/虫洞/AI入侵/海盗
 *       大会……）需要对应的天体/敌人类型都先存在，Phase8 选择先做这
 *       三种能用现有系统（飞船机动性/敌人生成/信用点奖励）稳健实现、
 *       立刻能让玩家感知到差异的类型，而不是塞一堆只有 toast 文案、
 *       没有任何机制效果的"装饰性事件"——这和 Phase2 的 WeaponDefs
 *       只给 7 条、Phase5 的 MissionDefs 只给 4 种是同一个取舍原则。
 *       本文件只负责"决定该发生什么、发生多久"，不直接操作飞船/敌人/
 *       UI——通过 EventBus 广播意图，main.js 监听后决定具体怎么应用
 *       （调多少速度惩罚、刷几艘敌人、给多少奖励），这样
 *       RandomEventSystem 不需要认识 PlayerShip/EnemyShip 这些具体类，
 *       符合项目从 Phase1 就坚持的 EventBus 解耦设计。
 * 输入：
 *   - 构造：{ eventBus }
 *   - update(dt, currentSectorKey)：每帧调用
 * 输出：'event:spaceStormStart' / 'event:spaceStormEnd' /
 *       'event:pirateRaid' / 'event:derelictFound' 事件
 * 调用关系：由 main.js 创建单例；main.js 监听广播的事件做具体应用
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

const EVENT_INTERVAL_RANGE = [90, 180]; // 秒，两次随机事件之间的间隔
const SPACE_STORM_DURATION = 40; // 秒

const EVENT_WEIGHTS = Object.freeze([
  { type: 'spaceStorm', weight: 3 },
  { type: 'pirateRaid', weight: 3 },
  { type: 'derelictFound', weight: 2 },
]);

export class RandomEventSystem {
  /** @param {{eventBus: import('../core/EventBus.js').EventBus}} config */
  constructor({ eventBus }) {
    this.eventBus = eventBus;
    this._nextEventTimer = this._rollInterval();
    this._stormTimeRemaining = 0;
  }

  _rollInterval() {
    const [min, max] = EVENT_INTERVAL_RANGE;
    return min + Math.random() * (max - min);
  }

  _pickEventType() {
    const total = EVENT_WEIGHTS.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * total;
    for (const entry of EVENT_WEIGHTS) {
      if (roll < entry.weight) return entry.type;
      roll -= entry.weight;
    }
    return EVENT_WEIGHTS[EVENT_WEIGHTS.length - 1].type;
  }

  /**
   * @param {number} dt 秒
   * @param {string|null} currentSectorKey 玩家当前所在扇区（降落/对接中可能拿不到，传 null 即可）
   */
  update(dt, currentSectorKey) {
    if (this._stormTimeRemaining > 0) {
      this._stormTimeRemaining -= dt;
      if (this._stormTimeRemaining <= 0) {
        this._stormTimeRemaining = 0;
        this.eventBus.emit('event:spaceStormEnd', {});
      }
    }

    if (!currentSectorKey) return; // 不知道玩家在哪个扇区时不触发新事件（例如降落/对接中）

    this._nextEventTimer -= dt;
    if (this._nextEventTimer > 0) return;
    this._nextEventTimer = this._rollInterval();

    this._trigger(this._pickEventType(), currentSectorKey);
  }

  _trigger(type, sectorKey) {
    if (type === 'spaceStorm') {
      // 已经在暴风里就不重复触发第二场，避免惩罚不小心叠加
      if (this._stormTimeRemaining > 0) return;
      this._stormTimeRemaining = SPACE_STORM_DURATION;
      this.eventBus.emit('event:spaceStormStart', { sectorKey, duration: SPACE_STORM_DURATION });
    } else if (type === 'pirateRaid') {
      this.eventBus.emit('event:pirateRaid', { sectorKey });
    } else if (type === 'derelictFound') {
      this.eventBus.emit('event:derelictFound', { sectorKey });
    }
  }
}
