/**
 * Minimap.js
 * ------------------------------------------------------------------
 * 功能：世界坐标系对齐（不随飞船朝向旋转）的 2D 雷达小地图，展示玩家
 *       附近的行星/空间站/敌人相对位置。对应需求文档「二十、UI」里
 *       明确要求的"小地图/雷达"。选择世界坐标系固定朝向而不是"雷达
 *       跟着飞船转、永远朝上"的常见做法，是因为前者实现更简单、没有
 *       旋转方向的符号错误风险——玩家可以通过中心的朝向三角形理解
 *       自己的朝向，不需要整张雷达图跟着转来"帮"玩家理解。
 *       每帧调用 update() 时清空重建实体图层的 SVG 内容——雷达上的
 *       实体数量通常是个位数到二十位数，重建开销可以忽略，不需要做
 *       增量 diff。
 * 输入：
 *   - 构造：{ rangeWorldUnits? }（雷达能显示多远，默认 900）
 *   - update({ playerShip, galaxyStreamer, enemies })：每帧调用
 * 输出：this.svgElement（供调用方插入 DOM）
 * 调用关系：由 main.js 创建一次，update() 在主循环里和 HUD 一起刷新
 * 复杂度：update() 为 O(附近扇区天体数 + 敌人数)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

const VIEWBOX_SIZE = 200;
const CENTER = VIEWBOX_SIZE / 2;
const RADAR_RADIUS = 92;
const SVG_NS = 'http://www.w3.org/2000/svg';

// 复用的临时向量，避免每帧 new，减少 GC 压力（Minimap 全局只有一个实例，
// 模块级单例临时变量在这里是安全的）
const _tmpForward = new THREE.Vector3();

export class Minimap {
  /** @param {{rangeWorldUnits?: number}} [config] */
  constructor({ rangeWorldUnits = 900 } = {}) {
    this.rangeWorldUnits = rangeWorldUnits;

    this.svgElement = document.createElementNS(SVG_NS, 'svg');
    this.svgElement.setAttribute('viewBox', `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    this.svgElement.setAttribute('class', 'minimap-svg');

    this._buildStaticBackground();

    this._entityLayer = document.createElementNS(SVG_NS, 'g');
    this.svgElement.appendChild(this._entityLayer);
  }

  _buildStaticBackground() {
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', String(CENTER));
    ring.setAttribute('cy', String(CENTER));
    ring.setAttribute('r', String(RADAR_RADIUS));
    ring.setAttribute('class', 'minimap-ring');
    this.svgElement.appendChild(ring);

    const crossH = document.createElementNS(SVG_NS, 'line');
    crossH.setAttribute('x1', String(CENTER - RADAR_RADIUS));
    crossH.setAttribute('y1', String(CENTER));
    crossH.setAttribute('x2', String(CENTER + RADAR_RADIUS));
    crossH.setAttribute('y2', String(CENTER));
    crossH.setAttribute('class', 'minimap-crosshair');
    this.svgElement.appendChild(crossH);

    const crossV = document.createElementNS(SVG_NS, 'line');
    crossV.setAttribute('x1', String(CENTER));
    crossV.setAttribute('y1', String(CENTER - RADAR_RADIUS));
    crossV.setAttribute('x2', String(CENTER));
    crossV.setAttribute('y2', String(CENTER + RADAR_RADIUS));
    crossV.setAttribute('class', 'minimap-crosshair');
    this.svgElement.appendChild(crossV);

    // 玩家自身：中心固定的朝向三角形，每帧只更新它的 points 属性
    this._playerMarker = document.createElementNS(SVG_NS, 'polygon');
    this._playerMarker.setAttribute('class', 'minimap-player');
    this.svgElement.appendChild(this._playerMarker);
  }

  /**
   * @param {object} params
   * @param {import('../ship/PlayerShip.js').PlayerShip} params.playerShip
   * @param {import('../galaxy/GalaxyStreamer.js').GalaxyStreamer} params.galaxyStreamer
   * @param {import('../enemy/EnemyShip.js').EnemyShip[]} params.enemies
   */
  update({ playerShip, galaxyStreamer, enemies }) {
    const playerPos = playerShip.object3D.position;
    const range = this.rangeWorldUnits;

    // 朝向三角形：只用飞船前向向量在水平面（X-Z）上的投影，忽略俯仰。
    // 角度约定与 enemy/EnemyAIController.js 的 _computeSteering 完全一致
    // （atan2(x, -z)），保持全项目"飞船朝向角度怎么算"只有一套约定。
    _tmpForward.set(0, 0, -1).applyQuaternion(playerShip.object3D.quaternion);
    const headingAngle = Math.atan2(_tmpForward.x, -_tmpForward.z);
    this._playerMarker.setAttribute('points', this._trianglePoints(headingAngle));

    this._entityLayer.innerHTML = '';

    for (const { position } of galaxyStreamer.findNearbyPlanets(playerPos, range)) {
      this._addDot(position, playerPos, range, 'minimap-dot minimap-dot--planet');
    }
    for (const { position } of galaxyStreamer.findNearbyStations(playerPos, range)) {
      this._addDot(position, playerPos, range, 'minimap-dot minimap-dot--station');
    }
    for (const enemy of enemies) {
      if (enemy.health.isDestroyed) continue;
      this._addDot(enemy.object3D.position, playerPos, range, 'minimap-dot minimap-dot--enemy');
    }
  }

  /**
   * 把一个世界坐标转换成雷达上的点并添加到实体图层。世界坐标系对齐：
   * 雷达上的"右"对应世界 +X，雷达上的"上"对应世界 -Z（前方）——
   * 与 Three.js 相机默认朝向 -Z 为"前方"的约定保持一致的直觉。
   */
  _addDot(worldPos, playerPos, range, className) {
    const dx = worldPos.x - playerPos.x;
    const dz = worldPos.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range) return; // 超出雷达范围就不显示，不做"贴边"处理，保持实现简单

    const px = CENTER + (dx / range) * RADAR_RADIUS;
    const py = CENTER + (dz / range) * RADAR_RADIUS;

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', px.toFixed(1));
    dot.setAttribute('cy', py.toFixed(1));
    dot.setAttribute('r', '2.6');
    dot.setAttribute('class', className);
    this._entityLayer.appendChild(dot);
  }

  /** 生成一个尖端指向 angle 方向的三角形 points 属性值（坐标系约定同 _addDot） */
  _trianglePoints(angle) {
    const size = 6;
    const tipX = CENTER + Math.sin(angle) * size;
    const tipY = CENTER - Math.cos(angle) * size;
    const backAngle1 = angle + (Math.PI * 2) / 3;
    const backAngle2 = angle - (Math.PI * 2) / 3;
    const b1x = CENTER + Math.sin(backAngle1) * (size * 0.55);
    const b1y = CENTER - Math.cos(backAngle1) * (size * 0.55);
    const b2x = CENTER + Math.sin(backAngle2) * (size * 0.55);
    const b2y = CENTER - Math.cos(backAngle2) * (size * 0.55);
    return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}`;
  }
}
