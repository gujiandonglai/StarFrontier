/**
 * Starfield.js
 * ------------------------------------------------------------------
 * 功能：程序生成分层星空背景（THREE.Points），通过多层不同半径/尺寸/
 *       颜色的点云营造视差深度感。这是「十六、程序生成」需求中最先落地
 *       的一块——真正的银河/星系生成将在 Phase3 的 galaxy/generation
 *       模块中实现，Starfield 仅作为最外层不可到达的天穹背景。
 *       Phase7 起构造函数接受可选的 densityMultiplier，供「图形质量」
 *       设置项按比例缩放每层的点数——低配置设备可以调低这个值省下
 *       每帧的绘制开销，不需要改动 StarfieldConfig 本身。
 * 输入：构造 (densityMultiplier?: number)，读取 StarfieldConfig
 * 输出：this.group（THREE.Group，包含所有层），update(dt) 方法
 * 调用关系：由 main.js 创建并通过 SceneManager.add(..., {updatable})
 *           注册；未来 galaxy 模块可据此扩展为「可飞入」的真实星域
 * 复杂度：构造期 O(总点数)；update() 为 O(层数)，与点数无关（仅旋转 group）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { StarfieldConfig } from '../config/GameConfig.js';

export class Starfield {
  /** @param {number} [densityMultiplier] 每层点数的缩放比例，默认 1（不缩放） */
  constructor(densityMultiplier = 1) {
    this.group = new THREE.Group();
    this.group.name = 'Starfield';
    this._layers = [];

    for (const layerCfg of StarfieldConfig.LAYERS) {
      const scaledCfg = { ...layerCfg, count: Math.max(1, Math.round(layerCfg.count * densityMultiplier)) };
      const points = this._buildLayer(scaledCfg);
      this._layers.push(points);
      this.group.add(points);
    }
  }

  /**
   * 生成单层星空点云
   * @param {{count:number, radius:number, size:number, color:number}} cfg
   * @returns {THREE.Points}
   */
  _buildLayer(cfg) {
    const positions = new Float32Array(cfg.count * 3);

    for (let i = 0; i < cfg.count; i++) {
      // 在球壳内随机分布，使用球坐标以避免立方体分布在角落堆积的问题
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // 半径在 [0.6R, R] 之间随机，制造有厚度的球壳而非单薄球面
      const r = cfg.radius * (0.6 + 0.4 * Math.random());

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: cfg.color,
      size: cfg.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    return new THREE.Points(geometry, material);
  }

  /**
   * 每帧更新：极缓慢旋转，制造深空并非完全静止的生命感
   * @param {number} dt 秒
   */
  update(dt) {
    this.group.rotation.y += StarfieldConfig.ROTATION_SPEED * dt;
  }
}
