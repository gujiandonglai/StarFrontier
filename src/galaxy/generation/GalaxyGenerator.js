/**
 * GalaxyGenerator.js
 * ------------------------------------------------------------------
 * 功能：给定扇区坐标 (sectorX, sectorZ)，确定性地生成该扇区的「数据描述」
 *       ——有没有恒星系、恒星类型、行星列表（类型/半径/轨道半径/公转与
 *       自转速度）、是否有小行星带、阵营领地标签。本文件只产出纯数据
 *       （不创建任何 THREE.Object3D），渲染层交给
 *       galaxy/CelestialBodyFactory.js——这样数据结构可以直接被 Phase7
 *       的存档系统序列化，也方便未来写单元测试验证「同种子必出同宇宙」。
 *       扇区网格铺在世界的 X-Z 水平面上（Y 轴留给天体自身的垂直分布与
 *       飞船飞行高度），这是「银河是一张二维星图，飞船在三维空间里飞」
 *       的简化处理，足以支撑开放宇宙探索的玩法需求，也避免了三维扇区
 *       网格在 Phase3 阶段带来的不必要复杂度。
 * 输入：generateSector(sectorX, sectorZ)
 * 输出：SectorData 描述对象（见下方 typedef）
 * 调用关系：被 galaxy/GalaxyStreamer.js 调用；生成结果交给
 *           galaxy/CelestialBodyFactory.js 转换为可渲染物体
 * 复杂度：generateSector() 为 O(该扇区行星数量)，与其它扇区是否已生成无关
 * ------------------------------------------------------------------
 */
import { GalaxyConfig } from '../../config/GameConfig.js';
import { SeededRandom, hashSeed } from '../../utils/SeededRandom.js';

const PLANET_TYPES = Object.freeze([
  'rocky',
  'gas_giant',
  'ice',
  'volcanic',
  'ocean',
  'desert',
]);

const STAR_TYPES = Object.freeze([
  { id: 'blue_giant', color: 0x9db4ff, radiusRange: [42, 60] },
  { id: 'yellow_dwarf', color: 0xffe28a, radiusRange: [22, 32] },
  { id: 'red_dwarf', color: 0xff8a65, radiusRange: [14, 20] },
  { id: 'white_dwarf', color: 0xf5f5ff, radiusRange: [8, 12] },
]);

const PLANET_COLOR_PALETTE = {
  rocky: [0x8a7f76, 0xab9c8d],
  gas_giant: [0xd9a066, 0xf2c879],
  ice: [0xbfe6ff, 0xe8f7ff],
  volcanic: [0x5c1f1f, 0xff6a3d],
  ocean: [0x1f6f8f, 0x3fa6c9],
  desert: [0xd9b26f, 0xe8caa0],
};

const SECTOR_NAME_PREFIXES = [
  '天鹰', '织女', '天狼', '轩辕', '苍龙', '玄武', '荧惑', '启明', '瀚海', '孤鸿',
];

const STATION_NAME_PARTS = [
  '曙光', '归墟', '朔风', '青鸾', '望舒', '烛龙', '扶摇', '南拱', '孤帆', '寒渊',
];
const STATION_NAME_SUFFIXES = ['贸易站', '中继站', '前哨站', '补给站'];

/**
 * @typedef {Object} PlanetData
 * @property {string} type 六种地表类型之一，决定行星颜色与降落后的地貌主题
 * @property {number} radius
 * @property {number} orbitRadius 与恒星的距离
 * @property {number} orbitSpeed 弧度/秒（正负决定公转方向）
 * @property {number} orbitPhase 初始相位（弧度）
 * @property {number} axialTilt
 * @property {number} spinSpeed
 * @property {number} colorHex
 * @property {boolean} landable
 * @property {number} seed 该行星表面生成所使用的种子（供 planet/PlanetSurfaceGenerator 使用）
 */

/**
 * @typedef {Object} StationData
 * @property {string} name
 * @property {number} orbitRadius
 * @property {number} orbitSpeed
 * @property {number} orbitPhase
 * @property {number} seed 该站点市场定价所使用的种子（供 economy/Market.js 使用）
 * @property {number} dockingRadius 允许触发对接的距离
 */

/**
 * @typedef {Object} SectorData
 * @property {number} sectorX
 * @property {number} sectorZ
 * @property {boolean} hasStarSystem
 * @property {{type:string, color:number, radius:number}|null} star
 * @property {PlanetData[]} planets
 * @property {boolean} hasAsteroidBelt
 * @property {{count:number, innerRadius:number, outerRadius:number, seed:number}|null} asteroidBelt
 * @property {StationData|null} station
 * @property {string} territory 阵营领地标签（Phase5 前仅作展示）
 * @property {string} sectorName
 */

export class GalaxyGenerator {
  /** @param {number} [globalSeed] */
  constructor(globalSeed = GalaxyConfig.SEED) {
    this.globalSeed = globalSeed >>> 0;
  }

  /**
   * @param {number} sectorX
   * @param {number} sectorZ
   * @returns {SectorData}
   */
  generateSector(sectorX, sectorZ) {
    const rng = new SeededRandom(hashSeed(this.globalSeed, sectorX, sectorZ));
    const cfg = GalaxyConfig;

    const hasStarSystem = rng.chance(cfg.STAR_SPAWN_CHANCE);
    const territory = rng.pick(cfg.TERRITORIES);
    const sectorName = this._generateSectorName(rng, sectorX, sectorZ);

    if (!hasStarSystem) {
      // 无主空域：仍有机会出现一片孤立的小行星带，避免完全空白无聊
      const hasAsteroidBelt = rng.chance(cfg.ASTEROID_BELT_CHANCE * 0.6);
      return {
        sectorX,
        sectorZ,
        hasStarSystem: false,
        star: null,
        planets: [],
        hasAsteroidBelt,
        asteroidBelt: hasAsteroidBelt
          ? {
              count: rng.int(cfg.ASTEROID_COUNT[0], cfg.ASTEROID_COUNT[1]),
              innerRadius: 200,
              outerRadius: 900,
              seed: hashSeed(this.globalSeed, sectorX, sectorZ, 9999),
            }
          : null,
        station: null,
        territory,
        sectorName,
      };
    }

    const starType = rng.pick(STAR_TYPES);
    const star = {
      type: starType.id,
      color: starType.color,
      radius: rng.range(starType.radiusRange[0], starType.radiusRange[1]),
    };

    const planetCount = rng.int(cfg.PLANETS_PER_SYSTEM[0], cfg.PLANETS_PER_SYSTEM[1]);
    const planets = [];
    let orbitCursor = star.radius * 3.2;
    for (let i = 0; i < planetCount; i++) {
      orbitCursor += rng.range(90, 220);
      const type = rng.pick(PLANET_TYPES);
      planets.push({
        type,
        radius: rng.range(6, 26),
        orbitRadius: orbitCursor,
        orbitSpeed: rng.range(0.004, 0.02) * (rng.chance(0.5) ? 1 : -1),
        orbitPhase: rng.range(0, Math.PI * 2),
        axialTilt: rng.range(-0.5, 0.5),
        spinSpeed: rng.range(0.05, 0.3),
        colorHex: rng.pick(PLANET_COLOR_PALETTE[type]),
        landable: true,
        seed: hashSeed(this.globalSeed, sectorX, sectorZ, i + 1),
      });
    }

    const hasAsteroidBelt = rng.chance(cfg.ASTEROID_BELT_CHANCE);
    const asteroidBelt = hasAsteroidBelt
      ? {
          count: rng.int(cfg.ASTEROID_COUNT[0], cfg.ASTEROID_COUNT[1]),
          innerRadius: orbitCursor + 60,
          outerRadius: orbitCursor + 160,
          seed: hashSeed(this.globalSeed, sectorX, sectorZ, 9999),
        }
      : null;

    // 空间站：只出现在有恒星系的扇区，轨道半径落在行星带范围内，
    // 让玩家探索星系时自然而然会撞见它，而不需要单独的雷达提示
    const hasStation = rng.chance(cfg.STATION_SPAWN_CHANCE);
    const station = hasStation
      ? {
          name: this._generateStationName(rng),
          orbitRadius: rng.range(star.radius * 3.2, Math.max(star.radius * 3.2 + 1, orbitCursor)),
          orbitSpeed: rng.range(0.002, 0.006) * (rng.chance(0.5) ? 1 : -1),
          orbitPhase: rng.range(0, Math.PI * 2),
          seed: hashSeed(this.globalSeed, sectorX, sectorZ, 8888),
          dockingRadius: 45,
        }
      : null;

    return {
      sectorX,
      sectorZ,
      hasStarSystem: true,
      star,
      planets,
      hasAsteroidBelt,
      asteroidBelt,
      station,
      territory,
      sectorName,
    };
  }

  _generateStationName(rng) {
    return `${rng.pick(STATION_NAME_PARTS)}${rng.pick(STATION_NAME_SUFFIXES)}`;
  }

  _generateSectorName(rng, sectorX, sectorZ) {
    const suffix = rng.int(1, 999).toString().padStart(3, '0');
    return `${rng.pick(SECTOR_NAME_PREFIXES)}星域 [${sectorX},${sectorZ}]-${suffix}`;
  }
}
