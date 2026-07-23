/**
 * EffectManager.js
 * ------------------------------------------------------------------
 * 功能：把「战斗发生了什么」翻译成「屏幕上应该出现什么特效」。本身不
 *       产生伤害/命中判定，只订阅 EventBus 上的战斗事件
 *       （weapon:fired / combat:projectileImpact / combat:destroyed），
 *       并调用 ParticleSystem 触发对应预设的粒子爆发。这种「事件驱动」
 *       写法使得未来新增音效系统（Phase「二十二、音效」）时，只需要
 *       再订阅同一批事件即可播放对应音效，完全不需要改动武器/碰撞/
 *       生命值等核心战斗逻辑。
 * 输入：构造：{ eventBus, particleSystem }
 * 输出：无（纯副作用：触发粒子爆发）
 * 调用关系：由 main.js 创建一次；不需要被其他模块引用
 * 复杂度：每次事件回调 O(1)（实际粒子开销在 ParticleSystem 内部）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { EffectPresets } from './EffectPresets.js';

export class EffectManager {
  /**
   * @param {object} config
   * @param {import('../core/EventBus.js').EventBus} config.eventBus
   * @param {import('../particle/ParticleSystem.js').ParticleSystem} config.particleSystem
   */
  constructor({ eventBus, particleSystem }) {
    this.eventBus = eventBus;
    this.particleSystem = particleSystem;
    this._tmpForward = new THREE.Vector3();

    this._unsubscribers = [
      eventBus.on('weapon:fired', (payload) => this._onWeaponFired(payload)),
      eventBus.on('combat:projectileImpact', (payload) => this._onProjectileImpact(payload)),
      eventBus.on('combat:destroyed', (payload) => this._onDestroyed(payload)),
    ];
  }

  _onWeaponFired({ position, quaternion, color }) {
    // MUZZLE_FLASH 预设的 spread<1 需要配合 direction 才会真正朝前喷射，
    // 否则 ParticleSystem 会静默退化为全向散射（见 ParticleSystem._activateSlot）
    this._tmpForward.set(0, 0, -1).applyQuaternion(quaternion);
    this.particleSystem.spawnBurst(position, {
      ...EffectPresets.MUZZLE_FLASH,
      colorHex: color,
      direction: this._tmpForward,
    });
  }

  _onProjectileImpact({ position, color }) {
    this.particleSystem.spawnBurst(position, {
      ...EffectPresets.PROJECTILE_IMPACT,
      colorHex: color,
    });
  }

  _onDestroyed({ worldPosition }) {
    if (!worldPosition) return;
    this.particleSystem.spawnBurst(worldPosition, {
      ...EffectPresets.SHIP_EXPLOSION,
      colorHex: 0xffb84d,
    });
  }

  dispose() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
