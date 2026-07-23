/**
 * Projectile.js
 * ------------------------------------------------------------------
 * 功能：单个弹丸实体。设计为可被 ObjectPool 反复借用/归还：configure()
 *       在「借出」时按具体 WeaponDef 初始化外观与飞行参数，reset() 在
 *       「归还」时清空状态、隐藏网格。追踪导弹（homing=true）会在飞行
 *       过程中持续小角度修正速度方向朝向目标，非瞬间转向，模拟真实的
 *       转向角速度限制。
 * 输入：configure(options) 见下方 JSDoc；update(dt) 每帧调用
 * 输出：this.mesh（已加入场景，通过 visible 控制显隐）、
 *       this.collider（注册进 CollisionSystem）
 * 调用关系：由 weapon/ProjectileManager.js 通过 ObjectPool 创建与复用
 * 复杂度：update() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { Collider } from '../physics/Collider.js';
import { CollisionGroup } from '../physics/CollisionGroups.js';

// 共享几何体：所有弹丸复用同一份 BufferGeometry，只通过 scale 区分大小，
// 避免每种武器都各自创建一份几何体数据（对应「二十三、性能」的显存优化要求）。
const _sharedCoreGeometry = new THREE.SphereGeometry(1, 6, 6);
const _sharedStreakGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
/** @type {Map<number, THREE.MeshBasicMaterial>} 按颜色缓存材质，减少材质对象数量 */
const _materialCache = new Map();

function getMaterialForColor(colorHex) {
  if (!_materialCache.has(colorHex)) {
    _materialCache.set(
      colorHex,
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        toneMapped: false, // 保持弹丸颜色鲜艳，不被 ACES 色调映射压暗
      })
    );
  }
  return _materialCache.get(colorHex);
}

export class Projectile {
  constructor() {
    this.mesh = new THREE.Group();
    this.mesh.visible = false;

    this.core = new THREE.Mesh(_sharedCoreGeometry, getMaterialForColor(0xffffff));
    this.mesh.add(this.core);

    this.streak = new THREE.Mesh(_sharedStreakGeometry, getMaterialForColor(0xffffff));
    this.streak.rotation.x = Math.PI / 2; // 圆柱默认沿 Y 轴，旋转到沿 Z 轴对齐前进方向
    this.mesh.add(this.streak);

    this.collider = new Collider({
      object3D: this.mesh,
      radius: 0.1,
      group: CollisionGroup.PLAYER_PROJECTILE, // 仅为初始占位值，configure() 会用真实归属方覆盖
      onHit: (other) => this._handleHit(other),
      ownerEntityId: null,
      data: this,
    });
    this.collider.active = false;

    this.velocity = new THREE.Vector3();
    this.def = null;
    this.life = 0;
    this.maxLife = 0;
    this.active = false;
    this.homingTarget = null; // THREE.Object3D | null
    this._onExpire = null; // ProjectileManager 注入的回收回调
    this._onImpact = null; // ProjectileManager 注入的命中回调（用于触发特效事件）

    this._tmpDir = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
  }

  /**
   * 从对象池借出时调用，按武器定义与发射姿态初始化
   * @param {object} options
   * @param {import('./WeaponDefs.js').WeaponDef} options.def
   * @param {string} options.group CollisionGroup（PLAYER_PROJECTILE / ENEMY_PROJECTILE）
   * @param {THREE.Vector3} options.position 发射点世界坐标
   * @param {THREE.Quaternion} options.quaternion 发射朝向
   * @param {number} options.ownerEntityId 发射者 Health.entityId，避免命中自己
   * @param {THREE.Object3D|null} [options.homingTarget] 追踪目标（missile 专用）
   */
  configure({ def, group, position, quaternion, ownerEntityId, homingTarget }) {
    this.def = def;
    this.active = true;
    this.life = 0;
    this.maxLife = def.lifetime;
    this.homingTarget = homingTarget ?? null;

    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(quaternion);
    this.mesh.visible = true;

    const scale = Math.max(def.projectileRadius, 0.05);
    this.core.scale.setScalar(scale);
    // 拖尾长度与弹速正相关，视觉上越快的弹丸拖尾越长
    const streakLength = Math.min(4.5, def.projectileSpeed / 140);
    this.streak.scale.set(scale * 0.6, streakLength, scale * 0.6);
    this.streak.position.set(0, 0, streakLength * 0.5);

    const material = getMaterialForColor(def.color);
    this.core.material = material;
    this.streak.material = material;

    this._tmpDir.set(0, 0, -1).applyQuaternion(quaternion);
    this.velocity.copy(this._tmpDir).multiplyScalar(def.projectileSpeed);

    this.collider.group = group;
    this.collider.radius = def.projectileRadius;
    this.collider.ownerEntityId = ownerEntityId;
    this.collider.active = true;
  }

  /** 归还给对象池时调用，清空引用避免内存泄漏 */
  reset() {
    this.active = false;
    this.mesh.visible = false;
    this.collider.active = false;
    this.homingTarget = null;
    this.def = null;
  }

  _handleHit(otherCollider) {
    if (!this.active) return;
    this._onImpact?.(this, otherCollider);
    this.active = false; // 命中后本帧末尾会被 ProjectileManager 回收
  }

  /**
   * 每帧更新弹道。返回 true 表示本帧应被回收（命中或超时）。
   * @param {number} dt 秒
   * @returns {boolean}
   */
  update(dt) {
    if (!this.active) return true;

    if (this.def.homing && this.homingTarget) {
      this._tmpDir.copy(this.homingTarget.position).sub(this.mesh.position).normalize();
      const currentDir = this.velocity.clone().normalize();
      // 用向量插值 + 归一化限制每帧最大转向角度，模拟导弹转向角速度上限
      const maxAngle = this.def.turnRateRadPerSec * dt;
      const angleTo = currentDir.angleTo(this._tmpDir);
      const t = angleTo > 0 ? Math.min(1, maxAngle / angleTo) : 0;
      currentDir.lerp(this._tmpDir, t).normalize();
      this.velocity.copy(currentDir).multiplyScalar(this.def.projectileSpeed);
    }

    this.mesh.position.addScaledVector(this.velocity, dt);

    // 朝向与飞行方向对齐，让拖尾视觉正确
    this._tmpDir.copy(this.velocity).normalize();
    this._tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this._tmpDir);
    this.mesh.quaternion.copy(this._tmpQuat);

    this.life += dt;
    if (this.life >= this.maxLife) {
      this.active = false;
      return true;
    }
    return false;
  }
}
