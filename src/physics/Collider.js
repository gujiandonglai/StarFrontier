/**
 * Collider.js
 * ------------------------------------------------------------------
 * 功能：轻量的球形碰撞体数据结构。不持有网格/材质等渲染信息，只关心
 *       「世界坐标 + 半径 + 分组 + 命中回调」，保持与渲染完全解耦，
 *       方便未来把物理判定移入 WebWorker（Phase8+ 大量舰队 AI 场景下
 *       的性能优化方向）而不影响渲染线程。
 * 输入：见构造函数参数
 * 输出：this.getWorldPosition()，onHit(otherCollider) 回调触发
 * 调用关系：由 ship/PlayerShip.js、enemy/EnemyShip.js、
 *           weapon/Projectile.js 创建，注册进 physics/CollisionSystem.js
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

export class Collider {
  /**
   * @param {object} config
   * @param {THREE.Object3D} config.object3D 提供世界坐标的节点
   * @param {number} config.radius 碰撞球半径
   * @param {string} config.group CollisionGroup 中的分组
   * @param {(other: Collider) => void} config.onHit 命中时的回调，
   *        由持有者（Projectile/Health）决定命中后做什么（扣血/自我销毁）
   * @param {number} [config.ownerEntityId] 关联的 Health.entityId，
   *        用于伤害来源追踪与「不打自己」的兜底判断
   */
  constructor(config) {
    this.object3D = config.object3D;
    this.radius = config.radius;
    this.group = config.group;
    this.onHit = config.onHit;
    this.ownerEntityId = config.ownerEntityId ?? null;
    this.active = true;
    /**
     * 通用的「反向引用」字段：例如 Projectile 会把 this.collider.data = this，
     * 这样命中方（飞船）在 onHit(other) 回调里可以通过 other.data 拿到
     * 具体的 Projectile 实例（读取伤害数值、命中位置等），而不需要
     * CollisionSystem 或 Collider 本身认识 Projectile 这个具体类型。
     */
    this.data = config.data ?? null;
  }

  /**
   * 读取当前世界坐标
   * @param {THREE.Vector3} [target] 复用向量，避免每次调用都分配新对象
   * @returns {THREE.Vector3}
   */
  getWorldPosition(target = new THREE.Vector3()) {
    return this.object3D.getWorldPosition(target);
  }
}
