/**
 * CelestialBodyFactory.js
 * ------------------------------------------------------------------
 * 功能：把 GalaxyGenerator 产出的纯数据 SectorData 转换成可渲染、可更新
 *       的 Three.js 场景内容。恒星使用发光材质 + Canvas 生成的日冕光晕
 *       贴图（Sprite）；行星挂在独立的「轨道枢轴」Object3D 下匀速公转，
 *       行星自身再绕本地 Y 轴自转——这是最常见的父子层级轨道动画技巧，
 *       不需要每帧手工计算三角函数位置。小行星带用单个 InstancedMesh
 *       渲染，满足「二十三、性能」中「实例化渲染」的要求。Phase4 起，
 *       若该扇区数据里带有 station 字段，还会调用
 *       station/StationFactory.js 构建一个同样挂在轨道枢轴上的空间站。
 * 输入：buildStarSystem(sectorData, sectorWorldOrigin)
 * 输出：StarSystem 实例：{ group, planets, station, update(dt), dispose() }
 * 调用关系：被 galaxy/GalaxyStreamer.js 在加载/卸载扇区时调用
 * 复杂度：构建为 O(行星数+小行星数)；update() 为 O(行星数)——小行星带本身
 *         静止不公转（只做一次性摆放），以节省每帧计算量，星系尺度下
 *         玩家很难察觉这个简化
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom.js';
import { buildStation } from '../station/StationFactory.js';

export class PlanetInstance {
  /**
   * @param {THREE.Group} pivot 公转枢轴（绕恒星旋转）
   * @param {THREE.Mesh} mesh 行星本体（绕自身 Y 轴自转）
   * @param {import('./generation/GalaxyGenerator.js').PlanetData} data
   */
  constructor(pivot, mesh, data) {
    this.pivot = pivot;
    this.mesh = mesh;
    this.data = data;
  }

  update(dt) {
    this.pivot.rotation.y += this.data.orbitSpeed * dt;
    this.mesh.rotation.y += this.data.spinSpeed * dt;
  }

  /**
   * 行星当前世界坐标（供降落判定/雷达 UI 使用）。Three.js 的
   * getWorldPosition() 内部会先做一次 updateWorldMatrix()，
   * 因此这里读到的始终是「本帧最新」的位置，不存在渲染滞后一帧的问题。
   * @param {THREE.Vector3} [target]
   */
  getWorldPosition(target = new THREE.Vector3()) {
    return this.mesh.getWorldPosition(target);
  }
}

export class StarSystem {
  /**
   * @param {THREE.Group} group
   * @param {PlanetInstance[]} planets
   * @param {import('../station/StationFactory.js').StationInstance|null} station
   * @param {import('./generation/GalaxyGenerator.js').SectorData} sectorData
   */
  constructor(group, planets, station, sectorData) {
    this.group = group;
    this.planets = planets;
    this.station = station;
    this.sectorData = sectorData;
  }

  update(dt) {
    for (const planet of this.planets) planet.update(dt);
    if (this.station) this.station.update(dt);
  }

  /** 场景卸载时释放几何体/材质，避免长时间流式加载卸载造成显存泄漏 */
  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

/**
 * @param {import('./generation/GalaxyGenerator.js').SectorData} sectorData
 * @param {THREE.Vector3} sectorWorldOrigin 该扇区在世界坐标系中的原点（扇区中心）
 * @returns {StarSystem|null} 若该扇区没有恒星系则返回 null（调用方自行决定
 *          是否仍要为「无主空域」渲染孤立小行星带）
 */
export function buildStarSystem(sectorData, sectorWorldOrigin) {
  if (!sectorData.hasStarSystem) return null;

  const group = new THREE.Group();
  group.name = `StarSystem_${sectorData.sectorX}_${sectorData.sectorZ}`;
  group.position.copy(sectorWorldOrigin);

  // ---- 恒星本体 + 点光源 + 日冕光晕 ----
  const starGeo = new THREE.SphereGeometry(sectorData.star.radius, 24, 24);
  const starMat = new THREE.MeshBasicMaterial({ color: sectorData.star.color, toneMapped: false });
  group.add(new THREE.Mesh(starGeo, starMat));

  const light = new THREE.PointLight(
    sectorData.star.color,
    3.5,
    sectorData.star.radius * 220,
    1.4
  );
  group.add(light);
  group.add(_buildCoronaSprite(sectorData.star));

  // ---- 行星（轨道枢轴 + 本体 + 轨道可视化圆环） ----
  const planets = [];
  for (const planetData of sectorData.planets) {
    const pivot = new THREE.Group();
    pivot.rotation.y = planetData.orbitPhase;

    const planetMat = new THREE.MeshStandardMaterial({
      color: planetData.colorHex,
      roughness: 0.85,
      metalness: 0.05,
    });
    const planetGeo = new THREE.SphereGeometry(planetData.radius, 20, 20);
    const planetMesh = new THREE.Mesh(planetGeo, planetMat);
    planetMesh.position.set(planetData.orbitRadius, 0, 0);
    planetMesh.rotation.z = planetData.axialTilt;
    pivot.add(planetMesh);
    group.add(pivot);

    // 轨道路径可视化：极淡的圆环线，帮助玩家目视判断可飞往的行星距离
    const ringGeo = new THREE.RingGeometry(
      planetData.orbitRadius - 0.4,
      planetData.orbitRadius + 0.4,
      64
    );
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2ec4ff,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(ringGeo, ringMat));

    planets.push(new PlanetInstance(pivot, planetMesh, planetData));
  }

  // ---- 小行星带（单个 InstancedMesh，静止不公转） ----
  if (sectorData.hasAsteroidBelt) {
    group.add(_buildAsteroidBelt(sectorData.asteroidBelt));
  }

  // ---- 空间站（若有） ----
  let station = null;
  if (sectorData.station) {
    station = buildStation(sectorData.station);
    group.add(station.pivot);
  }

  return new StarSystem(group, planets, station, sectorData);
}

/** 用 Canvas 生成一张径向渐变贴图，作为恒星的日冕光晕 Sprite */
function _buildCoronaSprite(star) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const hex = `#${star.color.toString(16).padStart(6, '0')}`;
  gradient.addColorStop(0, hex);
  gradient.addColorStop(0.4, hex);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(star.radius * 6);
  return sprite;
}

/** @param {import('./generation/GalaxyGenerator.js').SectorData['asteroidBelt']} beltData */
function _buildAsteroidBelt(beltData) {
  const rng = new SeededRandom(beltData.seed);
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x8a8378,
    roughness: 1,
    metalness: 0.1,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, beltData.count);
  mesh.name = 'AsteroidBelt';

  const dummy = new THREE.Object3D();
  for (let i = 0; i < beltData.count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(beltData.innerRadius, beltData.outerRadius);
    const height = rng.range(-25, 25);
    dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    dummy.scale.setScalar(rng.range(1.2, 5.5));
    dummy.rotation.set(
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2)
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
