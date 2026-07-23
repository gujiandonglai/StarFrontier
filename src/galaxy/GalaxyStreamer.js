/**
 * GalaxyStreamer.js
 * ------------------------------------------------------------------
 * 功能：银河的「流式加载」管理器。每帧检查玩家当前所在的扇区坐标，
 *       若与上次不同，则计算需要加载的扇区集合（以玩家扇区为中心的
 *       (2*LOAD_RADIUS_SECTORS+1)² 网格），生成尚未加载的扇区并卸载
 *       多余的扇区。这就是需求文档「玩家飞到哪里，就生成哪里，不用
 *       一次加载全部」的具体实现——整个银河从不会被同时实例化。
 *       同一扇区多次进入会得到完全相同的内容（由 GalaxyGenerator 的
 *       确定性种子保证），但已卸载扇区目前不保留运行期状态（例如行星
 *       表面已开采的资源不会记住），这类持久化留给 Phase7 存档系统
 *       接入 IndexedDB 后再处理。Phase4 起，有空间站的扇区还会额外
 *       生成几艘在站点周边巡航的环境 NPC（npc/NPCShip.js），随扇区
 *       一起加载/卸载。Phase8 起，扇区加载时会向
 *       faction/GalacticWarSimulator.js 登记，该扇区"实际控制阵营"
 *       此后可能因为背景战争模拟而与程序生成时的原始归属不同——
 *       findNearbyStations() 与 currentControllingFactionId 返回的都是
 *       实时结果，不是生成时的静态值。
 * 输入：
 *   - 构造：{ sceneManager, galaxyGenerator, warSimulator? }
 *   - update(playerWorldPosition)：每帧调用
 * 输出：this.currentSectorData（当前所在扇区的数据，供 HUD 展示）；
 *       this.currentControllingFactionId（当前扇区实际控制阵营，动态）；
 *       findNearbyPlanets(position, maxDistance)；
 *       findNearbyStations(position, maxDistance)
 * 调用关系：由 main.js 创建单例，每帧传入玩家飞船世界坐标
 * 复杂度：正常情况下 O(1)（只有跨越扇区边界时才有 O(加载半径²) 的生成开销）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { GalaxyConfig, NPCConfig } from '../config/GameConfig.js';
import { SeededRandom, hashSeed } from '../utils/SeededRandom.js';
import { TERRITORY_TO_FACTION } from '../faction/FactionDefs.js';
import { buildStarSystem } from './CelestialBodyFactory.js';
import { NPCShip } from '../npc/NPCShip.js';

export class GalaxyStreamer {
  /**
   * @param {object} config
   * @param {import('../scene/SceneManager.js').SceneManager} config.sceneManager
   * @param {import('./generation/GalaxyGenerator.js').GalaxyGenerator} config.galaxyGenerator
   * @param {import('../faction/GalacticWarSimulator.js').GalacticWarSimulator|null} [config.warSimulator]
   */
  constructor({ sceneManager, galaxyGenerator, warSimulator = null }) {
    this.sceneManager = sceneManager;
    this.galaxyGenerator = galaxyGenerator;
    this.warSimulator = warSimulator;

    /** @type {Map<string, {sectorData:object, starSystem:import('./CelestialBodyFactory.js').StarSystem|null, npcs:NPCShip[]}>} */
    this._loaded = new Map();
    this._currentSectorKey = null;
  }

  _sectorCoordFor(worldPosition) {
    const size = GalaxyConfig.SECTOR_SIZE;
    return {
      sx: Math.floor(worldPosition.x / size + 0.5),
      sz: Math.floor(worldPosition.z / size + 0.5),
    };
  }

  _key(sx, sz) {
    return `${sx},${sz}`;
  }

  /**
   * 每帧调用：检测玩家所在扇区是否变化，必要时重新计算加载集合
   * @param {THREE.Vector3} playerWorldPosition
   */
  update(playerWorldPosition) {
    const { sx, sz } = this._sectorCoordFor(playerWorldPosition);
    const key = this._key(sx, sz);
    if (key === this._currentSectorKey) return; // 还在同一扇区，无需重新计算
    this._currentSectorKey = key;

    const radius = GalaxyConfig.LOAD_RADIUS_SECTORS;
    const wanted = new Set();
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        wanted.add(this._key(sx + dx, sz + dz));
      }
    }

    for (const [loadedKey, entry] of this._loaded) {
      if (!wanted.has(loadedKey)) this._unload(loadedKey, entry);
    }

    for (const wantedKey of wanted) {
      if (this._loaded.has(wantedKey)) continue;
      const [wsx, wsz] = wantedKey.split(',').map(Number);
      this._load(wantedKey, wsx, wsz);
    }
  }

  _load(key, sx, sz) {
    const sectorData = this.galaxyGenerator.generateSector(sx, sz);
    const size = GalaxyConfig.SECTOR_SIZE;
    const sectorWorldOrigin = new THREE.Vector3(sx * size, 0, sz * size);
    const starSystem = buildStarSystem(sectorData, sectorWorldOrigin);

    if (starSystem) {
      this.sceneManager.add(starSystem.group, { updatable: starSystem });
    }

    const npcs = this._spawnNPCs(sectorData, sectorWorldOrigin, starSystem);

    this._loaded.set(key, { sectorData, starSystem, npcs });

    // Phase8：登记进战争模拟的跟踪范围（幂等，重复登记同一扇区不会重置状态）
    this.warSimulator?.registerSector(key, TERRITORY_TO_FACTION[sectorData.territory] ?? null);
  }

  /**
   * 解析某个扇区当前"实际控制阵营"——如果有战争模拟器且该扇区易过主，
   * 返回易主后的结果；否则返回程序生成时的原始归属（无主星域为 null）
   * @param {string} sectorKey
   * @param {import('./generation/GalaxyGenerator.js').SectorData} sectorData
   * @returns {string|null}
   */
  _resolveControllingFaction(sectorKey, sectorData) {
    const original = TERRITORY_TO_FACTION[sectorData.territory] ?? null;
    return this.warSimulator ? this.warSimulator.getControllingFaction(sectorKey, original) : original;
  }

  _unload(key, entry) {
    if (entry.starSystem) {
      this.sceneManager.remove(entry.starSystem.group, { updatable: entry.starSystem });
      entry.starSystem.dispose();
    }
    for (const npc of entry.npcs) {
      this.sceneManager.remove(npc.object3D, { updatable: npc });
    }
    this._loaded.delete(key);
  }

  /**
   * 只在有空间站的扇区生成环境 NPC——没有站点的扇区通常是「无主/荒芜」
   * 空域，没有平民交通反而更符合直觉。航点第一个固定为站点当前位置
   * （鼓励 NPC 视觉上频繁经过站点，强化"这里是枢纽"的印象），其余
   * 航点在扇区中心（恒星）周围随机撒点。
   * @param {import('./generation/GalaxyGenerator.js').SectorData} sectorData
   * @param {THREE.Vector3} sectorWorldOrigin
   * @param {import('./CelestialBodyFactory.js').StarSystem|null} starSystem
   * @returns {NPCShip[]}
   */
  _spawnNPCs(sectorData, sectorWorldOrigin, starSystem) {
    if (!sectorData.station || !starSystem || !starSystem.station) return [];

    const rng = new SeededRandom(
      hashSeed(this.galaxyGenerator.globalSeed, sectorData.sectorX, sectorData.sectorZ, 7777)
    );
    const count = rng.int(NPCConfig.PER_STATION_COUNT[0], NPCConfig.PER_STATION_COUNT[1]);
    const npcs = [];

    for (let i = 0; i < count; i++) {
      const waypoints = [starSystem.station.getWorldPosition()];
      const waypointCount = rng.int(NPCConfig.WAYPOINT_COUNT[0], NPCConfig.WAYPOINT_COUNT[1]);
      for (let w = 0; w < waypointCount; w++) {
        const angle = rng.range(0, Math.PI * 2);
        const radius = rng.range(NPCConfig.WAYPOINT_RADIUS * 0.3, NPCConfig.WAYPOINT_RADIUS);
        const height = rng.range(-60, 60);
        waypoints.push(
          new THREE.Vector3(
            sectorWorldOrigin.x + Math.cos(angle) * radius,
            sectorWorldOrigin.y + height,
            sectorWorldOrigin.z + Math.sin(angle) * radius
          )
        );
      }

      const npc = new NPCShip({ spawnPosition: waypoints[0].clone(), waypoints });
      this.sceneManager.add(npc.object3D, { updatable: npc });
      npcs.push(npc);
    }

    return npcs;
  }

  /**
   * 供降落判定/雷达 UI 使用：找出玩家附近所有可降落行星
   * @param {THREE.Vector3} playerWorldPosition
   * @param {number} maxDistance
   * @returns {Array<{position:THREE.Vector3, data:import('./generation/GalaxyGenerator.js').PlanetData, planetInstance:import('./CelestialBodyFactory.js').PlanetInstance}>}
   */
  findNearbyPlanets(playerWorldPosition, maxDistance) {
    const results = [];
    for (const entry of this._loaded.values()) {
      if (!entry.starSystem) continue;
      for (const planet of entry.starSystem.planets) {
        const pos = planet.getWorldPosition();
        if (pos.distanceTo(playerWorldPosition) <= maxDistance) {
          results.push({ position: pos, data: planet.data, planetInstance: planet });
        }
      }
    }
    return results;
  }

  /**
   * 供对接判定使用：找出玩家附近所有可对接空间站
   * @param {THREE.Vector3} playerWorldPosition
   * @param {number} maxDistance
   * @returns {Array<{position:THREE.Vector3, data:import('./generation/GalaxyGenerator.js').StationData, stationInstance:import('../station/StationFactory.js').StationInstance, controllingFactionId:string|null}>}
   */
  findNearbyStations(playerWorldPosition, maxDistance) {
    const results = [];
    for (const [sectorKey, entry] of this._loaded) {
      if (!entry.starSystem || !entry.starSystem.station) continue;
      const station = entry.starSystem.station;
      const pos = station.getWorldPosition();
      if (pos.distanceTo(playerWorldPosition) <= maxDistance) {
        results.push({
          position: pos,
          data: station.data,
          stationInstance: station,
          controllingFactionId: this._resolveControllingFaction(sectorKey, entry.sectorData),
        });
      }
    }
    return results;
  }

  /**
   * 某个扇区当前是否在已加载范围内（供 main.js 判断"这次局势变化玩家
   * 是否能感知到"，只在已加载的扇区里才值得弹提示）
   * @param {string} sectorKey
   * @returns {boolean}
   */
  isSectorLoaded(sectorKey) {
    return this._loaded.has(sectorKey);
  }

  /** 当前所在扇区的数据（供 HUD 显示扇区名称），未加载完成时为 null */
  get currentSectorData() {
    const entry = this._loaded.get(this._currentSectorKey);
    return entry ? entry.sectorData : null;
  }

  /**
   * 当前所在扇区的实际控制阵营（动态，可能因战争模拟而与程序生成时不同），
   * 未加载完成或处于无主星域时为 null
   */
  get currentControllingFactionId() {
    const entry = this._loaded.get(this._currentSectorKey);
    if (!entry) return null;
    return this._resolveControllingFaction(this._currentSectorKey, entry.sectorData);
  }

  /** 当前所在扇区的键（"sx,sz" 格式），供 RandomEventSystem 等系统关联事件归属扇区使用 */
  get currentSectorKey() {
    return this._currentSectorKey;
  }
}
