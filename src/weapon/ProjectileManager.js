/**
 * ProjectileManager.js
 * ------------------------------------------------------------------
 * 功能：全局唯一的弹丸管理器。所有武器（无论玩家还是敌人）发射的弹丸
 *       都通过同一个 ObjectPool 借用/归还，所有弹丸的网格在构造时就
 *       一次性加入场景（通过 visible 控制显隐），避免每次开火都触发
 *       scene.add/remove 引起的场景图变更开销。命中/超时的弹丸在每帧
 *       update() 末尾统一回收。
 * 输入：
 *   - 构造：{ sceneManager, collisionSystem, eventBus, poolSize }
 *   - spawn(options) 见下方 JSDoc，返回 void
 *   - update(dt) 每帧调用
 * 输出：无直接返回值；副作用为管理弹丸网格显隐与碰撞注册
 * 调用关系：由 main.js 创建单例，注入给每个 WeaponSystem；
 *           注册进 SceneManager 的 updatable 队列
 * 复杂度：update() 为 O(活跃弹丸数量)
 * ------------------------------------------------------------------
 */
import { ObjectPool } from '../utils/ObjectPool.js';
import { Projectile } from './Projectile.js';

export class ProjectileManager {
  /**
   * @param {object} config
   * @param {import('../scene/SceneManager.js').SceneManager} config.sceneManager
   * @param {import('../physics/CollisionSystem.js').CollisionSystem} config.collisionSystem
   * @param {import('../core/EventBus.js').EventBus} config.eventBus
   * @param {number} [config.poolSize]
   */
  constructor({ sceneManager, collisionSystem, eventBus, poolSize = 96 }) {
    this.sceneManager = sceneManager;
    this.collisionSystem = collisionSystem;
    this.eventBus = eventBus;

    /** @type {Set<Projectile>} 当前活跃（正在飞行）的弹丸 */
    this._active = new Set();

    this._pool = new ObjectPool(
      () => this._createProjectile(),
      (p) => p.reset(),
      poolSize
    );
  }

  _createProjectile() {
    const projectile = new Projectile();
    // 弹丸网格在创建时就常驻场景（初始 visible=false），避免频繁增删场景节点
    this.sceneManager.add(projectile.mesh);
    projectile._onImpact = (proj, otherCollider) =>
      this._handleImpact(proj, otherCollider);
    return projectile;
  }

  _handleImpact(projectile, otherCollider) {
    const damageAmount = projectile.def.damage;
    // 实际扣血逻辑：otherCollider 所属实体的 Health 由该实体自身在 onHit 回调里处理，
    // 这里只广播视觉/音效需要的「命中」事件，避免 ProjectileManager 直接依赖 Health。
    this.eventBus.emit('combat:projectileImpact', {
      position: projectile.mesh.position.clone(),
      color: projectile.def.color,
      damage: damageAmount,
    });
  }

  /**
   * 发射一枚弹丸
   * @param {object} options
   * @param {import('./WeaponDefs.js').WeaponDef} options.def
   * @param {string} options.group CollisionGroup
   * @param {import('three').Vector3} options.position
   * @param {import('three').Quaternion} options.quaternion
   * @param {number} options.ownerEntityId
   * @param {import('three').Object3D|null} [options.homingTarget]
   */
  spawn(options) {
    const projectile = this._pool.acquire();
    projectile.configure(options);
    this._active.add(projectile);
    this.collisionSystem.register(projectile.collider);

    this.eventBus.emit('weapon:fired', {
      position: options.position,
      quaternion: options.quaternion,
      color: options.def.color,
      ownerEntityId: options.ownerEntityId,
    });
  }

  /** 每帧更新所有活跃弹丸，回收命中/超时的弹丸 */
  update(dt) {
    for (const projectile of [...this._active]) {
      const shouldRecycle = projectile.update(dt);
      if (shouldRecycle) {
        this.collisionSystem.unregister(projectile.collider);
        this._active.delete(projectile);
        this._pool.release(projectile);
      }
    }
  }

  get activeCount() {
    return this._active.size;
  }
}
