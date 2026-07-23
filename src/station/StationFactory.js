/**
 * StationFactory.js
 * ------------------------------------------------------------------
 * 功能：把 GalaxyGenerator 产出的 StationData 转换成可渲染、可更新、
 *       可对接的空间站实体。造型用基础几何体拼装（中心球体舱 + 一圈
 *       旋转对接环 + 四根桁架），不是照抄任何具体游戏的空间站设计，
 *       但足以让玩家一眼认出"这是站点，不是行星也不是敌人"。空间站
 *       和行星一样挂在轨道枢轴上公转，复用 galaxy/CelestialBodyFactory
 *       里验证过的父子层级轨道动画技巧。
 *       每个 StationInstance 持有一个独立的 economy/Market，市场种子
 *       来自 StationData.seed——同一个站点无论何时对接，固有的价格
 *       偏移都是一样的。
 * 输入：buildStation(stationData)
 * 输出：StationInstance：{ pivot, mesh, market, data, update(dt),
 *       getWorldPosition(target), dispose() }
 * 调用关系：被 galaxy/CelestialBodyFactory.js 在构建 StarSystem 时调用
 * 复杂度：构建为 O(1)；update() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { Market } from '../economy/Market.js';

export class StationInstance {
  /**
   * @param {THREE.Group} pivot 公转枢轴
   * @param {THREE.Group} mesh 站点本体（自转对接环）
   * @param {THREE.Mesh} ringMesh 对接环（单独持有引用以驱动自转）
   * @param {Market} market
   * @param {import('../galaxy/generation/GalaxyGenerator.js').StationData} data
   */
  constructor(pivot, mesh, ringMesh, market, data) {
    this.pivot = pivot;
    this.mesh = mesh;
    this.ringMesh = ringMesh;
    this.market = market;
    this.data = data;
  }

  update(dt) {
    this.pivot.rotation.y += this.data.orbitSpeed * dt;
    this.ringMesh.rotation.z += dt * 0.25; // 对接环缓慢自转，纯视觉效果
    this.market.update(dt);
  }

  /** @param {THREE.Vector3} [target] */
  getWorldPosition(target = new THREE.Vector3()) {
    return this.mesh.getWorldPosition(target);
  }

  dispose() {
    this.pivot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

/**
 * @param {import('../galaxy/generation/GalaxyGenerator.js').StationData} stationData
 * @returns {StationInstance}
 */
export function buildStation(stationData) {
  const pivot = new THREE.Group();
  pivot.rotation.y = stationData.orbitPhase;

  const mesh = new THREE.Group();
  mesh.name = `Station_${stationData.name}`;
  mesh.position.set(stationData.orbitRadius, 0, 0);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xb8c4d0,
    metalness: 0.8,
    roughness: 0.35,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffb84d,
    emissive: 0xffb84d,
    emissiveIntensity: 1.4,
    metalness: 0.3,
    roughness: 0.4,
  });

  // 中心舱：球体
  const coreGeo = new THREE.SphereGeometry(6, 16, 16);
  mesh.add(new THREE.Mesh(coreGeo, hullMat));

  // 对接环：TorusGeometry 默认躺在 XY 平面，绕 X 轴转 90° 使其水平环绕中心舱
  // （像光环一样躺在 XZ 平面），后续桁架/泊位灯都统一按这个水平面摆放，
  // 避免不同部件分属不同平面导致视觉对不上
  const ringGroup = new THREE.Group();
  const torusGeo = new THREE.TorusGeometry(16, 0.9, 10, 28);
  torusGeo.rotateX(Math.PI / 2);
  ringGroup.add(new THREE.Mesh(torusGeo, accentMat));

  // 四根桁架：水平面内每 90° 一根，从中心舱连到对接环
  const strutGeo = new THREE.BoxGeometry(16, 0.6, 0.6); // 沿局部 X 轴的长条
  for (let i = 0; i < 4; i++) {
    const strut = new THREE.Mesh(strutGeo, hullMat);
    strut.position.x = 8; // 从中心 0 延伸到半径 16（对接环所在处）
    const wrapper = new THREE.Group();
    wrapper.rotation.y = (Math.PI / 2) * i; // 绕竖直 Y 轴每次转 90°，四个水平方向
    wrapper.add(strut);
    ringGroup.add(wrapper);
  }
  mesh.add(ringGroup);

  // 泊位灯光：沿对接环均匀分布几个小光点，提示"这里可以停靠"
  const beaconGeo = new THREE.SphereGeometry(0.4, 8, 8);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const beacon = new THREE.Mesh(beaconGeo, accentMat);
    beacon.position.set(Math.cos(angle) * 16, 0, Math.sin(angle) * 16);
    ringGroup.add(beacon);
  }

  const pointLight = new THREE.PointLight(0xffb84d, 1.2, 120, 1.6);
  mesh.add(pointLight);

  pivot.add(mesh);

  const market = new Market(stationData.seed);

  return new StationInstance(pivot, mesh, ringGroup, market, stationData);
}
