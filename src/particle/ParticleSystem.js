/**
 * ParticleSystem.js
 * ------------------------------------------------------------------
 * 功能：全局单例粒子系统，所有特效（爆炸/弹道命中火花/枪口焰）共享
 *       同一个固定容量的粒子池与同一个 THREE.Points 绘制调用，避免
 *       「每次爆炸都新建一个 THREE.Points」带来的绘制调用暴增（对应
 *       「二十三、性能」中「实例化渲染」思路的粒子版本：这里用「单一
 *       Points + 动态顶点属性」实现等价效果）。
 *       视觉上使用「颜色随生命周期衰减到黑 + 加色混合（Additive）」
 *       的经典技巧：因为太空背景接近纯黑，衰减到黑色的粒子会自然融入
 *       背景，不需要真正的 alpha-per-vertex 着色器就能得到平滑淡出。
 * 输入：
 *   - 构造：{ maxParticles }
 *   - spawnBurst(origin, preset) 见下方 JSDoc
 *   - update(dt) 每帧调用
 * 输出：this.points（THREE.Points，需被加入场景一次）
 * 调用关系：由 main.js 创建单例并 add 进 SceneManager；
 *           被 effect/EffectManager.js 调用 spawnBurst()
 * 复杂度：update() 为 O(活跃粒子数)，构造为 O(maxParticles)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { randRange } from '../utils/MathUtils.js';

export class ParticleSystem {
  /**
   * @param {number} [maxParticles]
   */
  constructor(maxParticles = 2000) {
    this.maxParticles = maxParticles;

    this._positions = new Float32Array(maxParticles * 3);
    this._colors = new Float32Array(maxParticles * 3);

    this._velocities = new Float32Array(maxParticles * 3);
    this._life = new Float32Array(maxParticles);
    this._maxLife = new Float32Array(maxParticles);
    this._baseColor = new Float32Array(maxParticles * 3);
    this._active = new Uint8Array(maxParticles);

    /** @type {number[]} 空闲槽位索引栈 */
    this._freeList = [];
    for (let i = maxParticles - 1; i >= 0; i--) this._freeList.push(i);
    /** @type {Set<number>} 当前活跃槽位索引 */
    this._activeIndices = new Set();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));
    geometry.setDrawRange(0, 0); // 初始不绘制任何点，随活跃粒子数动态调整

    const material = new THREE.PointsMaterial({
      size: 1.4,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false; // 粒子分布范围随特效位置变化，简单起见不做视锥裁剪误判
    this._geometry = geometry;

    // 为了让绘制范围内的粒子紧凑排列（减少 GPU 端处理的无效点），
    // 使用「与最后一个活跃槽位交换」的技巧维护一个紧凑区间 [0, _liveCount)。
    this._slotToDrawIndex = new Int32Array(maxParticles).fill(-1);
    this._drawIndexToSlot = new Int32Array(maxParticles).fill(-1);
    this._liveCount = 0;
  }

  /**
   * 触发一次粒子爆发
   * @param {THREE.Vector3} origin 世界坐标原点
   * @param {object} preset 见 effect/EffectPresets.js 中的预设结构
   * @param {number} preset.count 粒子数量
   * @param {[number,number]} preset.speedRange 初速度范围
   * @param {[number,number]} preset.lifeRange 生命周期范围（秒）
   * @param {number} preset.colorHex 基础颜色
   * @param {number} [preset.spread] 方向散射范围，1=全向球形，0=几乎不散射
   */
  spawnBurst(origin, preset) {
    const color = new THREE.Color(preset.colorHex);
    for (let i = 0; i < preset.count; i++) {
      if (this._freeList.length === 0) return; // 粒子池已耗尽，静默丢弃，避免报错打断游戏
      const slot = this._freeList.pop();
      this._activateSlot(slot, origin, preset, color);
    }
  }

  _activateSlot(slot, origin, preset, color) {
    const spread = preset.spread ?? 1;
    // 在单位球内取随机方向，spread 控制与「正前方」夹角的最大散射程度
    const dir = new THREE.Vector3(
      randRange(-1, 1),
      randRange(-1, 1),
      randRange(-1, 1)
    ).normalize();
    if (spread < 1 && preset.direction) {
      dir.lerp(preset.direction, 1 - spread).normalize();
    }
    const speed = randRange(preset.speedRange[0], preset.speedRange[1]);

    const i3 = slot * 3;
    this._positions[i3] = origin.x;
    this._positions[i3 + 1] = origin.y;
    this._positions[i3 + 2] = origin.z;

    this._velocities[i3] = dir.x * speed;
    this._velocities[i3 + 1] = dir.y * speed;
    this._velocities[i3 + 2] = dir.z * speed;

    this._baseColor[i3] = color.r;
    this._baseColor[i3 + 1] = color.g;
    this._baseColor[i3 + 2] = color.b;
    this._colors[i3] = color.r;
    this._colors[i3 + 1] = color.g;
    this._colors[i3 + 2] = color.b;

    this._life[slot] = 0;
    this._maxLife[slot] = randRange(preset.lifeRange[0], preset.lifeRange[1]);
    this._active[slot] = 1;
    this._activeIndices.add(slot);
  }

  /** 每帧更新所有活跃粒子的位置与淡出颜色 */
  update(dt) {
    for (const slot of [...this._activeIndices]) {
      const i3 = slot * 3;
      this._life[slot] += dt;

      if (this._life[slot] >= this._maxLife[slot]) {
        this._active[slot] = 0;
        this._activeIndices.delete(slot);
        this._freeList.push(slot);
        this._colors[i3] = 0;
        this._colors[i3 + 1] = 0;
        this._colors[i3 + 2] = 0;
        continue;
      }

      this._positions[i3] += this._velocities[i3] * dt;
      this._positions[i3 + 1] += this._velocities[i3 + 1] * dt;
      this._positions[i3 + 2] += this._velocities[i3 + 2] * dt;

      const fade = 1 - this._life[slot] / this._maxLife[slot];
      this._colors[i3] = this._baseColor[i3] * fade;
      this._colors[i3 + 1] = this._baseColor[i3 + 1] * fade;
      this._colors[i3 + 2] = this._baseColor[i3 + 2] * fade;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    // 简单起见按 maxParticles 全量绘制（未活跃粒子颜色已淡为纯黑，
    // 配合加色混合几乎不可见）。粒子规模上升后可按 _liveCount 收紧 drawRange。
    this._geometry.setDrawRange(0, this.maxParticles);
  }
}
