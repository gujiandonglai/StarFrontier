/**
 * TechTreeSystem.js
 * ------------------------------------------------------------------
 * 功能：监听声望变化，检查每个阵营的科技树节点是否达到解锁门槛，首次
 *       达到时把对应的数值加成永久应用到玩家飞船。解锁是永久性的——
 *       即使后续声望回落到门槛以下，已经拿到的加成也不会被收回，这是
 *       刻意的简化（精确撤销加成需要额外追踪"这个数值有多少是加成
 *       带来的"，对 Phase5 的价值不大，不值得为此增加状态管理的复杂度）。
 * 输入：
 *   - 构造：{ playerShip, reputationSystem, eventBus }
 *   - checkUnlocks()：全量检查一次（构造时自动调用一次）
 * 输出：this.unlockedNodeIds: Set<string>；getAllNodesWithStatus() 供
 *       科技树 UI 展示锁定/已解锁状态；'techtree:unlocked' 事件
 * 调用关系：由 main.js 创建单例；被 ReputationSystem 的
 *          'reputation:changed' 事件驱动
 * 复杂度：checkUnlocks() 为 O(阵营数 × 每阵营节点数)，当前 4×2=8，可忽略
 * ------------------------------------------------------------------
 */
import { TECH_TREE_DEFS } from './TechTreeDefs.js';
import { standingAtLeast } from './ReputationSystem.js';

export class TechTreeSystem {
  /**
   * @param {object} deps
   * @param {import('../ship/PlayerShip.js').PlayerShip} deps.playerShip
   * @param {import('./ReputationSystem.js').ReputationSystem} deps.reputationSystem
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ playerShip, reputationSystem, eventBus }) {
    this.playerShip = playerShip;
    this.reputationSystem = reputationSystem;
    this.eventBus = eventBus;

    /** @type {Set<string>} */
    this.unlockedNodeIds = new Set();

    eventBus.on('reputation:changed', () => this.checkUnlocks());
    this.checkUnlocks(); // 初始检查一次，保持"任何时候构造完都处于一致状态"
  }

  checkUnlocks() {
    for (const [factionId, nodes] of Object.entries(TECH_TREE_DEFS)) {
      const standing = this.reputationSystem.getStanding(factionId);
      for (const node of nodes) {
        if (this.unlockedNodeIds.has(node.id)) continue;
        if (standingAtLeast(standing, node.requiredStanding)) {
          this._applyEffect(node);
          this.unlockedNodeIds.add(node.id);
          this.eventBus?.emit('techtree:unlocked', { nodeId: node.id, factionId, node });
        }
      }
    }
  }

  /** @param {import('./TechTreeDefs.js').TechNode} node */
  _applyEffect(node) {
    const { type, value } = node.effect;
    const physics = this.playerShip.physics;
    const health = this.playerShip.health;

    switch (type) {
      case 'speedMultiplierBonus':
        physics.maxSpeedMultiplier += value;
        break;
      case 'maxHullBonus':
        health.maxHull += value;
        health.hull += value; // 加成即时到账，不需要先掉血再"补满"到新上限
        break;
      case 'maxShieldBonus':
        health.maxShield += value;
        health.shield += value;
        break;
      case 'cargoCapacityBonus':
        this.playerShip.cargoHold.capacity += value;
        break;
      case 'shieldRegenBonus':
        health.shieldRegenPerSecond += value;
        break;
      default:
        console.warn(`[TechTreeSystem] 未知加成类型: ${type}`);
    }
  }

  /**
   * 供科技树 UI 展示：全部节点 + 当前是否已解锁
   * @returns {Array<import('./TechTreeDefs.js').TechNode & {factionId:string, unlocked:boolean}>}
   */
  getAllNodesWithStatus() {
    const result = [];
    for (const [factionId, nodes] of Object.entries(TECH_TREE_DEFS)) {
      for (const node of nodes) {
        result.push({ ...node, factionId, unlocked: this.unlockedNodeIds.has(node.id) });
      }
    }
    return result;
  }
}
