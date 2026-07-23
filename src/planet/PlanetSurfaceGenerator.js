/**
 * PlanetSurfaceGenerator.js
 * ------------------------------------------------------------------
 * 功能：给定一颗行星的 PlanetData（含 seed 与 type），生成一块可探索的
 *       地表场景：起伏地形（值噪声高度图，按行星类型着色）、散布的可
 *       采集资源节点、可视化并会造成持续伤害的环境危险区域。同一颗
 *       行星（同一个 seed）无论何时降落，地形与资源分布都完全一致——
 *       这是「银河程序生成保证每次开局不同，但同一颗行星本身是稳定
 *       世界」的具体体现。
 *       地表被处理成一块有限大小的方形地块（而非整颗球形星球的完整
 *       表面），飞出地块边界会被软性拦回——真正的「行星球面环绕」地形
 *       留给后续阶段，在浏览器原型阶段这是一个合理的简化，换来的是
 *       可以直接复用飞船现有的 6DOF 飞行手感在地表低空飞行，不需要
 *       另外做一套地面载具控制器。
 * 输入：generateSurface(planetData): 见下方
 * 输出：SurfaceScene 实例：{ group, resourceNodes, hazardZones, heightAt,
 *       palette, update(dt), dispose() }
 * 调用关系：被 planet/LandingController.js 在触发降落时调用一次
 * 复杂度：构建为 O(SURFACE_RESOLUTION² + 资源节点数 + 危险区数)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { PlanetConfig } from '../config/GameConfig.js';
import { SeededRandom } from '../utils/SeededRandom.js';
import { ValueNoise2D } from '../utils/NoiseUtils.js';
import { ResourceNode } from './ResourceNode.js';
import { pickWeightedResourceType } from '../economy/ResourceDefs.js';

/** 六种地表类型各自的地面配色 / 天空色 / 雾色 / 主要危险类型标签 */
const SURFACE_PALETTES = {
  rocky: { ground: [0x6b6259, 0x8a7f76], sky: 0x2a2622, fog: 0x3a342d, hazardLabel: '沙暴' },
  gas_giant: { ground: [0xd9a066, 0xf2c879], sky: 0x33220f, fog: 0x4a3216, hazardLabel: '辐射带' },
  ice: { ground: [0xcfeeff, 0xeaf9ff], sky: 0x0d1a26, fog: 0x1c2d3d, hazardLabel: '暴风雪' },
  volcanic: { ground: [0x2b1210, 0xff6a3d], sky: 0x1a0805, fog: 0x2e0f0a, hazardLabel: '熔岩喷口' },
  ocean: { ground: [0x123f4f, 0x3fa6c9], sky: 0x0a1f28, fog: 0x123240, hazardLabel: '洪泛区' },
  desert: { ground: [0xd9b26f, 0xe8caa0], sky: 0x3a2a10, fog: 0x4d3a1a, hazardLabel: '沙暴' },
};

export class SurfaceScene {
  /**
   * @param {THREE.Group} group
   * @param {ResourceNode[]} resourceNodes
   * @param {Array<{x:number, z:number, radius:number, dps:number, label:string}>} hazardZones
   * @param {(x:number, z:number)=>number} heightAt 局部坐标（相对 group 原点）查询地形高度
   * @param {object} palette
   */
  constructor(group, resourceNodes, hazardZones, heightAt, palette) {
    this.group = group;
    this.resourceNodes = resourceNodes;
    this.hazardZones = hazardZones;
    this.heightAt = heightAt;
    this.palette = palette;
  }

  update(dt) {
    for (const node of this.resourceNodes) node.update(dt);
  }

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
 * @param {import('../galaxy/generation/GalaxyGenerator.js').PlanetData} planetData
 * @returns {SurfaceScene}
 */
export function generateSurface(planetData) {
  const rng = new SeededRandom(planetData.seed);
  const noise = new ValueNoise2D(planetData.seed);
  const palette = SURFACE_PALETTES[planetData.type] || SURFACE_PALETTES.rocky;
  const cfg = PlanetConfig;

  const group = new THREE.Group();
  group.name = `PlanetSurface_${planetData.type}`;

  // ---- 地形：噪声高度函数（几何体位移与 heightAt() 查询共用同一个公式，
  //      避免"渲染出来的地形"和"逻辑判定用的地形"出现两套数据不一致的 bug） ----
  function computeHeight(x, z) {
    return noise.fbm(x * cfg.NOISE_FREQUENCY, z * cfg.NOISE_FREQUENCY, 5, 0.5) * cfg.HEIGHT_SCALE;
  }

  const size = cfg.SURFACE_RADIUS * 2;
  const resolution = cfg.SURFACE_RESOLUTION;
  const geometry = new THREE.PlaneGeometry(size, size, resolution - 1, resolution - 1);
  geometry.rotateX(-Math.PI / 2); // PlaneGeometry 默认在 XY 平面，转到水平的 XZ 地面

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    posAttr.setY(i, computeHeight(posAttr.getX(i), posAttr.getZ(i)));
  }
  geometry.computeVertexNormals();

  // 用顶点色做高度渐变（低处 ground[0]，高处混合 ground[1]），配合 flatShading 呈现层次感
  const colorA = new THREE.Color(palette.ground[0]);
  const colorB = new THREE.Color(palette.ground[1]);
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const h = posAttr.getY(i);
    const t = THREE.MathUtils.clamp((h + cfg.HEIGHT_SCALE) / (cfg.HEIGHT_SCALE * 2), 0, 1);
    const c = colorA.clone().lerp(colorB, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const groundMesh = new THREE.Mesh(geometry, groundMat);
  groundMesh.name = 'Terrain';
  group.add(groundMesh);

  // ---- 资源节点：在地块内随机撒点，避开出生点附近一小片区域 ----
  const resourceNodes = [];
  const nodeCount = rng.int(cfg.RESOURCE_NODE_COUNT[0], cfg.RESOURCE_NODE_COUNT[1]);
  const margin = 20;
  for (let i = 0; i < nodeCount; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      x = rng.range(-cfg.SURFACE_RADIUS + margin, cfg.SURFACE_RADIUS - margin);
      z = rng.range(-cfg.SURFACE_RADIUS + margin, cfg.SURFACE_RADIUS - margin);
      if (Math.hypot(x, z) > 25) break; // 离出生点（地块中心）足够远就接受
    }
    const y = computeHeight(x, z) + 1.6;
    const resourceType = pickWeightedResourceType(rng);
    const node = new ResourceNode({
      position: new THREE.Vector3(x, y, z),
      resourceType,
      amount: rng.int(8, 20),
    });
    group.add(node.mesh);
    resourceNodes.push(node);
  }

  // ---- 危险区域：可视化的发光警戒圈 + 持续伤害判定数据 ----
  const hazardZones = [];
  const hazardCount = rng.int(cfg.HAZARD_ZONE_COUNT[0], cfg.HAZARD_ZONE_COUNT[1]);
  for (let i = 0; i < hazardCount; i++) {
    const x = rng.range(-cfg.SURFACE_RADIUS + margin, cfg.SURFACE_RADIUS - margin);
    const z = rng.range(-cfg.SURFACE_RADIUS + margin, cfg.SURFACE_RADIUS - margin);
    const radius = rng.range(cfg.HAZARD_RADIUS[0], cfg.HAZARD_RADIUS[1]);
    const dps = rng.range(cfg.HAZARD_DPS[0], cfg.HAZARD_DPS[1]);

    const ringGeo = new THREE.CircleGeometry(radius, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5d47,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(x, computeHeight(x, z) + 0.3, z);
    group.add(ringMesh);

    hazardZones.push({ x, z, radius, dps, label: palette.hazardLabel });
  }

  return new SurfaceScene(
    group,
    resourceNodes,
    hazardZones,
    (x, z) => computeHeight(x, z),
    palette
  );
}
