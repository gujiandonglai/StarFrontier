/**
 * EnemyShip.js
 * ------------------------------------------------------------------
 * 功能：敌方飞船实体。与 PlayerShip 共享完全相同的核心组件——
 *       ShipPhysics（飞行手感）、Health（护盾/装甲）、Collider（碰撞）、
 *       WeaponSystem（开火）——唯一的区别是驱动来源换成了
 *       EnemyAIController 而不是 InputController。这正是「组合优先于
 *       继承」原则的意义：EnemyShip 不需要继承 PlayerShip 就能复用同一
 *       套物理与战斗逻辑，也不会被玩家特有的东西（HUD 遥测细节等）污染。
 * 输入：
 *   - 构造：{ eventBus, projectileManager, collisionSystem, spawnPosition }
 *   - update(dt, playerShip)
 * 输出：
 *   - this.object3D  THREE.Group，代表飞船在世界中的位置与朝向
 *   - this.health    Health 组件，main.js 据此判断是否需要清理/计分
 *   - this.telemetry 只读遥测（暂未接入敌人专属 HUD，预留给 Phase5
 *     阵营/雷达 UI 使用）
 * 调用关系：由 main.js 批量创建并注册进场景与 CollisionSystem；
 *           被 main.js 每帧调用 update()
 * 复杂度：update() 为 O(1)（AI 决策与武器系统均为常数复杂度）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { EnemyShipDefaults, EnemyAIConfig } from '../config/GameConfig.js';
import { ShipPhysics } from '../ship/ShipPhysics.js';
import { Health } from '../ship/Health.js';
import { Collider } from '../physics/Collider.js';
import { CollisionGroup } from '../physics/CollisionGroups.js';
import { Weapon } from '../weapon/Weapon.js';
import { WeaponSystem } from '../weapon/WeaponSystem.js';
import { EnemyAIController } from './EnemyAIController.js';

export class EnemyShip {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   * @param {import('../weapon/ProjectileManager.js').ProjectileManager} deps.projectileManager
   * @param {import('../physics/CollisionSystem.js').CollisionSystem} deps.collisionSystem
   * @param {THREE.Vector3} deps.spawnPosition 出生点（同时作为巡逻锚点）
   * @param {number} [deps.attackAngle] 交战时盘旋点相对目标的固定角度（弧度），
   *        供 main.js 编队出生时给同队僚机分配不同角度实现包抄（Phase8）；
   *        不传则 EnemyAIController 内部随机生成
   */
  constructor({ eventBus, projectileManager, collisionSystem, spawnPosition, attackAngle }) {
    this.object3D = this._buildPlaceholderMesh();
    this.object3D.position.copy(spawnPosition);

    this.physics = new ShipPhysics(this.object3D, {
      maxSpeedMultiplier: EnemyShipDefaults.MAX_SPEED_MULTIPLIER,
      initialThrottle: EnemyAIConfig.THROTTLE_PATROL,
    });

    this.health = new Health({
      maxHull: EnemyShipDefaults.MAX_HULL,
      maxShield: EnemyShipDefaults.MAX_SHIELD,
      shieldRegenPerSecond: EnemyShipDefaults.SHIELD_REGEN_PER_SECOND,
      shieldRegenDelay: EnemyShipDefaults.SHIELD_REGEN_DELAY,
      eventBus,
      ownerTag: 'enemy',
    });

    this.collider = new Collider({
      object3D: this.object3D,
      radius: 2.6,
      group: CollisionGroup.ENEMY_SHIP,
      ownerEntityId: this.health.entityId,
      onHit: (other) => this._handleHit(other),
    });
    collisionSystem.register(this.collider);
    this._collisionSystem = collisionSystem;

    this.weaponSystem = new WeaponSystem({
      projectileManager,
      group: CollisionGroup.ENEMY_PROJECTILE,
      ownerEntityId: this.health.entityId,
      mounts: [
        {
          weapon: new Weapon(EnemyShipDefaults.PRIMARY_WEAPON_ID, 'primary'),
          localOffset: new THREE.Vector3(0, -0.1, -2.2),
          triggerId: 'primary',
        },
      ],
    });

    this.ai = new EnemyAIController({ eventBus, patrolAnchor: spawnPosition, attackAngle });

    this.telemetry = {
      speed: 0,
      throttle: this.physics.throttle,
      boosting: false,
      hullRatio: 1,
      shieldRatio: 1,
      destroyed: false,
      aiState: this.ai.state,
    };
  }

  /**
   * 占位敌机外观：几何结构与 PlayerShip 相同（八面体机身+双翼+引擎光点），
   * 但使用红/橙色调（而非玩家的青色），让玩家一眼就能分辨敌我。
   * 与 PlayerShip 一样，Phase6+ 接入真实模型时只需替换本方法。
   * @returns {THREE.Group}
   */
  _buildPlaceholderMesh() {
    const group = new THREE.Group();
    group.name = 'EnemyShip';

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a4a,
      metalness: 0.65,
      roughness: 0.4,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff5d47,
      emissive: 0xff5d47,
      emissiveIntensity: 1.6,
      metalness: 0.2,
      roughness: 0.4,
    });

    const bodyGeo = new THREE.ConeGeometry(0.9, 4.2, 8);
    const body = new THREE.Mesh(bodyGeo, hullMat);
    body.rotation.x = -Math.PI / 2; // 机头朝向局部 -Z（前方），与 PlayerShip 保持一致的约定
    group.add(body);

    const wingGeo = new THREE.BoxGeometry(3.6, 0.12, 1.1);
    const wingL = new THREE.Mesh(wingGeo, hullMat);
    wingL.position.set(-1.6, 0, 0.6);
    const wingR = wingL.clone();
    wingR.position.x = 1.6;
    group.add(wingL, wingR);

    const engineGeo = new THREE.SphereGeometry(0.28, 12, 12);
    const engineL = new THREE.Mesh(engineGeo, accentMat);
    engineL.position.set(-0.9, 0, 2.1);
    const engineR = engineL.clone();
    engineR.position.x = 0.9;
    group.add(engineL, engineR);
    this._engineGlows = [engineL, engineR];

    return group;
  }

  /**
   * 承受伤害的入口：由 Collider.onHit 在 CollisionSystem 检测到
   * 「玩家弹丸命中本机船体」时调用
   * @param {import('../physics/Collider.js').Collider} otherCollider
   */
  _handleHit(otherCollider) {
    const projectile = otherCollider.data;
    if (!projectile || !projectile.def) return;
    this.health.takeDamage(projectile.def.damage, {
      sourceEntityId: otherCollider.ownerEntityId,
      sourceTag: otherCollider.group,
      worldPosition: this.object3D.position.clone(),
    });
  }

  /**
   * 每帧更新：AI 决策 -> 飞行物理 -> 武器 -> 生命值
   * @param {number} dt 秒
   * @param {import('../ship/PlayerShip.js').PlayerShip|null} playerShip 当前的索敌目标
   */
  update(dt, playerShip) {
    if (this.health.isDestroyed) return; // 阵亡后由 main.js 负责清理，本帧不再驱动

    const decision = this.ai.decide(dt, {
      selfObject3D: this.object3D,
      selfHealth: this.health,
      targetObject3D: playerShip ? playerShip.object3D : null,
      targetDestroyed: playerShip ? playerShip.health.isDestroyed : true,
    });

    this.physics.throttle = decision.throttle;
    this.physics.update(dt, {
      pitch: decision.pitch,
      yaw: decision.yaw,
      roll: decision.roll,
      boost: decision.boost,
      brake: false,
      throttleDelta: 0,
    });

    this.weaponSystem.update(dt, this.object3D, { primary: decision.firePrimary }, null);
    this.health.update(dt);

    const glowIntensity = 1.0 + this.physics.throttle * 2.0 + (decision.boost ? 1.5 : 0);
    for (const glow of this._engineGlows) {
      glow.material.emissiveIntensity = glowIntensity;
    }

    this.telemetry.speed = this.physics.telemetry.speed;
    this.telemetry.throttle = this.physics.telemetry.throttle;
    this.telemetry.boosting = this.physics.telemetry.boosting;
    this.telemetry.hullRatio = this.health.hullRatio;
    this.telemetry.shieldRatio = this.health.shieldRatio;
    this.telemetry.destroyed = this.health.isDestroyed;
    this.telemetry.aiState = this.ai.state;
  }

  /** 从场景/碰撞系统/事件总线彻底摘除（阵亡清理或场景卸载时调用） */
  dispose() {
    this._collisionSystem.unregister(this.collider);
    this.ai.dispose();
  }
}
