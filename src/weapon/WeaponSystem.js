/**
 * WeaponSystem.js
 * ------------------------------------------------------------------
 * 功能：挂载在某一艘飞船上的武器系统，管理该飞船的武器挂点（Weapon
 *       实例数组），把「本帧扳机是否按下」翻译成具体的弹丸发射请求，
 *       并把发射点从飞船局部坐标换算到世界坐标（考虑飞船当前朝向）。
 *       玩家与敌人共用同一个 WeaponSystem 实现——玩家的扳机信号来自
 *       InputController，敌人的扳机信号来自 EnemyAIController，两者
 *       对 WeaponSystem 而言没有区别，这正是 EventBus/组合式架构
 *       希望达到的解耦效果。
 * 输入：
 *   - 构造：{ projectileManager, mounts, group, ownerEntityId }
 *     mounts: Array<{ weapon: Weapon, localOffset: THREE.Vector3, triggerId: string }>
 *   - update(dt, object3D, triggers, homingTarget, energyCore?)
 *     triggers: Record<triggerId, boolean>，例如 { primary: true, secondary: false }
 *     energyCore: 传入则每次开火会做能量判定（Phase6，目前只有玩家飞船会传）
 * 输出：无返回值；副作用是调用 projectileManager.spawn()
 * 调用关系：被 ship/PlayerShip.js 与 enemy/EnemyShip.js 持有
 * 复杂度：update() 为 O(挂点数量)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

export class WeaponSystem {
  /**
   * @param {object} config
   * @param {import('./ProjectileManager.js').ProjectileManager} config.projectileManager
   * @param {Array<{weapon: import('./Weapon.js').Weapon, localOffset: THREE.Vector3, triggerId: string}>} config.mounts
   * @param {string} config.group CollisionGroup（该飞船发射的弹丸属于哪一组）
   * @param {number} config.ownerEntityId 关联的 Health.entityId
   */
  constructor({ projectileManager, mounts, group, ownerEntityId }) {
    this.projectileManager = projectileManager;
    this.mounts = mounts;
    this.group = group;
    this.ownerEntityId = ownerEntityId;

    this._tmpWorldPos = new THREE.Vector3();
  }

  /**
   * @param {number} dt 秒
   * @param {THREE.Object3D} object3D 飞船根节点，提供世界坐标系换算
   * @param {Record<string, boolean>} triggers 各扳机通道的按下状态
   * @param {THREE.Object3D|null} [homingTarget] 供 missile 类武器追踪的目标节点
   * @param {import('../ship/EnergyCore.js').EnergyCore|null} [energyCore] 传入则开火受能量限制
   */
  update(dt, object3D, triggers, homingTarget = null, energyCore = null) {
    for (const mount of this.mounts) {
      const triggerHeld = !!triggers[mount.triggerId];
      const shouldFire = mount.weapon.tryFire(dt, triggerHeld, energyCore);
      if (!shouldFire) continue;

      // 直接用本帧刚更新过的 position/quaternion 计算枪口世界坐标，
      // 不使用 object3D.matrixWorld —— 它只在渲染时才刷新，此时读取
      // 会落后一帧（高速飞行时枪口位置会明显偏离机头）
      this._tmpWorldPos
        .copy(mount.localOffset)
        .applyQuaternion(object3D.quaternion)
        .add(object3D.position);

      this.projectileManager.spawn({
        def: mount.weapon.def,
        group: this.group,
        position: this._tmpWorldPos.clone(),
        quaternion: object3D.quaternion.clone(),
        ownerEntityId: this.ownerEntityId,
        homingTarget: mount.weapon.def.homing ? homingTarget : null,
      });
    }
  }

  /** 供 HUD 读取所有挂点的冷却状态 */
  getMountsSnapshot() {
    return this.mounts.map((m) => ({
      triggerId: m.triggerId,
      name: m.weapon.def.name,
      cooldownRatio: m.weapon.cooldownRatio,
    }));
  }
}
