/**
 * CollisionSystem.js
 * ------------------------------------------------------------------
 * 功能：每帧对所有已注册的 Collider 做碰撞检测。为避免 O(n²) 暴力两两
 *       比较在敌人/子弹数量上升后（Phase8 动态战争的大规模舰队战）掉帧，
 *       采用「空间哈希网格」做粗筛（broad phase）——只有落在同一或相邻
 *       网格单元的物体才进入精确的球体距离判定（narrow phase）。
 *       这是文档「二十三、性能」要求的「八叉树」的一个简化替代方案：
 *       均匀网格实现更简单、常数因子更小，在飞船数量为「百」级时足够；
 *       如果后续场景规模进一步扩大到「千」级并出现明显空间聚集不均，
 *       再升级为八叉树，届时只需替换本文件的内部实现，register/
 *       unregister/update 的外部接口保持不变。
 * 输入：
 *   - register(collider), unregister(collider)
 *   - update()：每帧调用一次，内部完成粗筛+精筛+触发回调（本身不需要 dt）
 * 输出：无返回值，副作用是调用发生碰撞的双方 Collider.onHit()
 * 调用关系：由 main.js 创建单例，注册进 SceneManager 的 updatable 队列；
 *           被 PlayerShip / EnemyShip / Projectile 通过 register() 接入
 * 复杂度：理想情况下（物体分布均匀）broad phase 为 O(n)，
 *         最坏情况（全部堆叠在同一格）退化为 O(n²)
 * ------------------------------------------------------------------
 */
import { CollisionConfig } from '../config/GameConfig.js';
import { canCollide } from './CollisionGroups.js';

export class CollisionSystem {
  constructor() {
    /** @type {Set<import('./Collider.js').Collider>} */
    this._colliders = new Set();
    this._cellSize = CollisionConfig.CELL_SIZE;
    /** @type {Map<string, import('./Collider.js').Collider[]>} */
    this._grid = new Map();
  }

  register(collider) {
    this._colliders.add(collider);
  }

  unregister(collider) {
    this._colliders.delete(collider);
  }

  _cellKey(x, y, z) {
    const cs = this._cellSize;
    return `${Math.floor(x / cs)}_${Math.floor(y / cs)}_${Math.floor(z / cs)}`;
  }

  /** 每帧调用：重建网格 -> 遍历相邻格 -> 精确判定 -> 触发回调 */
  update() {
    this._grid.clear();

    // ---- Broad phase：把所有活跃 collider 分桶到网格 ----
    const positionCache = new Map(); // collider -> world position（本帧复用，避免重复计算）
    for (const collider of this._colliders) {
      if (!collider.active) continue;
      const pos = collider.getWorldPosition();
      positionCache.set(collider, pos);
      const key = this._cellKey(pos.x, pos.y, pos.z);
      if (!this._grid.has(key)) this._grid.set(key, []);
      this._grid.get(key).push(collider);
    }

    // ---- Narrow phase：仅比较同格与 26 个相邻格内的 collider 对 ----
    const checkedPairs = new Set();
    const cs = this._cellSize;

    for (const collider of this._colliders) {
      if (!collider.active) continue;
      const posA = positionCache.get(collider);
      const cx = Math.floor(posA.x / cs);
      const cy = Math.floor(posA.y / cs);
      const cz = Math.floor(posA.z / cs);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const neighborKey = `${cx + dx}_${cy + dy}_${cz + dz}`;
            const bucket = this._grid.get(neighborKey);
            if (!bucket) continue;

            for (const other of bucket) {
              if (other === collider || !other.active) continue;

              // 无向对去重：用两个 collider 的稳定顺序生成唯一 key
              const pairKey = this._pairKey(collider, other);
              if (checkedPairs.has(pairKey)) continue;
              checkedPairs.add(pairKey);

              if (!canCollide(collider.group, other.group)) continue;
              // 同一持有者（例如飞船自身与自身武器挂点）不判定
              if (
                collider.ownerEntityId !== null &&
                collider.ownerEntityId === other.ownerEntityId
              ) {
                continue;
              }

              const posB = positionCache.get(other);
              const rSum = collider.radius + other.radius;
              const distSq = posA.distanceToSquared(posB);
              if (distSq <= rSum * rSum) {
                collider.onHit?.(other);
                other.onHit?.(collider);
              }
            }
          }
        }
      }
    }
  }

  _pairKey(a, b) {
    // 用对象在 Set 中的插入顺序无关，改用简单的字符串拼接 + 排序
    const ia = a.__collisionId ?? (a.__collisionId = ++CollisionSystem._idCounter);
    const ib = b.__collisionId ?? (b.__collisionId = ++CollisionSystem._idCounter);
    return ia < ib ? `${ia}_${ib}` : `${ib}_${ia}`;
  }
}
CollisionSystem._idCounter = 0;
