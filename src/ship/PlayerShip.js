/**
 * PlayerShip.js
 * ------------------------------------------------------------------
 * 功能：玩家飞船实体。Phase1 实现了飞行物理与占位外观；Phase2 在此基础上
 *       组合进 Health（护盾/装甲）、WeaponSystem（主武器+副武器）与
 *       Collider（供敌方弹丸命中判定），并把 6DOF 飞行物理委托给可复用的
 *       ShipPhysics 组件（EnemyShip 使用同一份物理实现）。Phase6 追加了
 *       EnergyCore（武器开火消耗能量）与 ShipLoadout（模块化改装状态：
 *       引擎/装甲/护盾/反应堆/主副武器六个槽位，见 ship/ShipLoadout.js）。
 *       对外的 update(dt, inputState, homingTarget) 契约从 Phase1 到现在
 *       只新增过一个可选参数（homingTarget），没有破坏过原有调用方式。
 * 输入：
 *   - 构造：{ eventBus, projectileManager, collisionSystem }
 *   - update(dt, inputState, homingTarget?)
 * 输出：
 *   - this.object3D  THREE.Group，代表飞船在世界中的位置与朝向
 *   - this.telemetry 只读遥测数据（速度/油门/护盾/装甲/能量），供 HUD 渲染使用
 *   - this.health    Health 组件，供外部（main.js）判断玩家是否阵亡
 *   - this.loadout   ShipLoadout 组件，供改装面板 UI 调用 install()
 * 调用关系：由 main.js 创建并注册进 SceneManager；被 CameraRig 引用
 *           以获取跟随目标；被 CollisionSystem 驱动命中判定
 * 复杂度：update() 为 O(1)（不含 WeaponSystem 内部的挂点数量遍历，
 *         挂点数量为常数）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { PlayerShipDefaults, PlanetConfig } from '../config/GameConfig.js';
import { ShipPhysics } from './ShipPhysics.js';
import { Health } from './Health.js';
import { CargoHold } from './CargoHold.js';
import { Wallet } from './Wallet.js';
import { EnergyCore } from './EnergyCore.js';
import { ShipLoadout } from './ShipLoadout.js';
import { Collider } from '../physics/Collider.js';
import { CollisionGroup } from '../physics/CollisionGroups.js';
import { Weapon } from '../weapon/Weapon.js';
import { WeaponSystem } from '../weapon/WeaponSystem.js';

export class PlayerShip {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   * @param {import('../weapon/ProjectileManager.js').ProjectileManager} deps.projectileManager
   * @param {import('../physics/CollisionSystem.js').CollisionSystem} deps.collisionSystem
   */
  constructor({ eventBus, projectileManager, collisionSystem }) {
    this.object3D = this._buildPlaceholderMesh();
    this.physics = new ShipPhysics(this.object3D);

    this.health = new Health({
      maxHull: PlayerShipDefaults.MAX_HULL,
      maxShield: PlayerShipDefaults.MAX_SHIELD,
      shieldRegenPerSecond: PlayerShipDefaults.SHIELD_REGEN_PER_SECOND,
      shieldRegenDelay: PlayerShipDefaults.SHIELD_REGEN_DELAY,
      eventBus,
      ownerTag: 'player',
    });

    // Phase3：货舱作为飞船组件持有，Phase4 经济系统只需要读写这个对象，
    // 不需要关心资源是在哪颗行星上采到的
    this.cargoHold = new CargoHold(PlanetConfig.CARGO_CAPACITY);

    // Phase4：信用点钱包，同样是组合而非继承
    this.wallet = new Wallet();

    this.collider = new Collider({
      object3D: this.object3D,
      radius: 2.6,
      group: CollisionGroup.PLAYER_SHIP,
      ownerEntityId: this.health.entityId,
      onHit: (other) => this._handleHit(other),
    });
    collisionSystem.register(this.collider);
    this._collisionSystem = collisionSystem;

    this.weaponSystem = new WeaponSystem({
      projectileManager,
      group: CollisionGroup.PLAYER_PROJECTILE,
      ownerEntityId: this.health.entityId,
      mounts: [
        {
          weapon: new Weapon(PlayerShipDefaults.PRIMARY_WEAPON_ID, 'primary'),
          localOffset: new THREE.Vector3(0, -0.1, -2.6),
          triggerId: 'primary',
        },
        {
          weapon: new Weapon(PlayerShipDefaults.SECONDARY_WEAPON_ID, 'secondary'),
          localOffset: new THREE.Vector3(0, -0.3, -1.4),
          triggerId: 'secondary',
        },
      ],
    });

    // Phase6：能量电容，武器开火消耗能量（见 weapon/Weapon.js 的 tryFire）
    this.energyCore = new EnergyCore({
      maxEnergy: PlayerShipDefaults.MAX_ENERGY,
      regenPerSecond: PlayerShipDefaults.ENERGY_REGEN_PER_SECOND,
    });

    // 供 HUD 读取的遥测快照（每帧刷新，避免 HUD 直接持有物理/生命值对象）
    this.telemetry = {
      speed: 0,
      throttle: this.physics.throttle,
      boosting: false,
      hullRatio: 1,
      shieldRatio: 1,
      energyRatio: 1,
      destroyed: false,
    };

    // Phase6：模块化改装状态。必须放在构造函数最后——它的构造过程会
    // 读取 this.weaponSystem.mounts 来记录出厂武器 id，所以 physics/
    // health/energyCore/weaponSystem 必须都已经就绪
    this.loadout = new ShipLoadout({ playerShip: this });
  }

  /**
   * 用基础几何体拼装一个占位飞船外观。
   * 正式美术资源接入后（Phase6+），此方法会替换为 GLTFLoader 加载真实模型，
   * 但仍返回一个 THREE.Object3D，调用方无需改动。
   * @returns {THREE.Group}
   */
  _buildPlaceholderMesh() {
    const group = new THREE.Group();
    group.name = 'PlayerShip';

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x8fa3b3,
      metalness: 0.7,
      roughness: 0.35,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x2ec4ff,
      emissive: 0x2ec4ff,
      emissiveIntensity: 1.6,
      metalness: 0.2,
      roughness: 0.4,
    });

    const bodyGeo = new THREE.ConeGeometry(0.9, 4.2, 8);
    const body = new THREE.Mesh(bodyGeo, hullMat);
    body.rotation.x = -Math.PI / 2; // 让锥尖（机头）朝向局部 -Z（前方，与推进方向一致）
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
   * 「敌方弹丸命中我方船体」时调用
   * @param {import('../physics/Collider.js').Collider} otherCollider 命中我方的弹丸 Collider
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
   * 每帧更新飞船物理、武器、能量与生命值
   * @param {number} dt 秒
   * @param {import('../player/InputController.js').InputState} inputState
   * @param {THREE.Object3D|null} [homingTarget] 供副武器（导弹）追踪的当前锁定目标
   */
  update(dt, inputState, homingTarget = null) {
    this.physics.update(dt, inputState);
    this.weaponSystem.update(dt, this.object3D, inputState.triggers, homingTarget, this.energyCore);
    this.health.update(dt);
    this.energyCore.update(dt);

    const glowIntensity =
      1.0 + this.physics.throttle * 2.0 + (this.physics.telemetry.boosting ? 1.5 : 0);
    for (const glow of this._engineGlows) {
      glow.material.emissiveIntensity = glowIntensity;
    }

    this.telemetry.speed = this.physics.telemetry.speed;
    this.telemetry.throttle = this.physics.telemetry.throttle;
    this.telemetry.boosting = this.physics.telemetry.boosting;
    this.telemetry.hullRatio = this.health.hullRatio;
    this.telemetry.shieldRatio = this.health.shieldRatio;
    this.telemetry.energyRatio = this.energyCore.ratio;
    this.telemetry.destroyed = this.health.isDestroyed;
  }

  /** 重置飞船状态（重生/复活时调用） */
  respawn(position = new THREE.Vector3(0, 0, 0)) {
    this.object3D.position.copy(position);
    this.object3D.quaternion.identity();
    this.physics.velocity.set(0, 0, 0);
    this.physics.angularVelocity.set(0, 0, 0);
    this.physics.throttle = 0.35;
    this.health.hull = this.health.maxHull;
    this.health.shield = this.health.maxShield;
    this.health.isDestroyed = false;
    this.energyCore.current = this.energyCore.maxEnergy;
  }
}
