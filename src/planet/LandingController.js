/**
 * LandingController.js
 * ------------------------------------------------------------------
 * 功能：管理「太空 <-> 行星表面」两种飞行模式之间的切换，以及降落后的
 *       资源开采/危险区域交互。切换时不销毁太空场景——而是把玩家飞船
 *       连同一个专用的「地表舞台」根节点一起搬到远离银河扇区网格的
 *       固定坐标（Y=-500000，远超摄像机远裁剪面相对任何已加载扇区的
 *       视距），这样已加载的星系/敌人/星空背景不需要逐个隐藏或销毁，
 *       起飞后原封不动地飞回来。地表本身仍然复用飞船现成的 6DOF 飞行
 *       物理（只是叠加了地面碰撞高度与地块边界钳制），不需要另外做一套
 *       地面载具控制器——这是「组合优先于继承」原则在跨系统场景下的
 *       延伸应用。真正的「行星球面环绕地形」与「离开星球时地表状态持久
 *       化」留给后续阶段打磨。
 * 输入：
 *   - 构造：{ sceneManager, playerShip, galaxyStreamer, cargoHold, eventBus }
 *   - update(dt, inputState)：每帧调用
 * 输出：this.isLanded；this.canLand（供 HUD 显示"按 L 降落"提示）；
 *       this.currentSurface（含 palette，供 HUD 显示危险区域标签）
 * 调用关系：由 main.js 创建并驱动
 * 复杂度：update() 为 O(资源节点数 + 危险区数)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { PlanetConfig } from '../config/GameConfig.js';
import { generateSurface } from './PlanetSurfaceGenerator.js';

// 远离银河扇区网格（SECTOR_SIZE=4000）的专用地表舞台锚点，
// 保证降落后玩家看不到、也碰不到任何太空场景内容
const SURFACE_STAGE_ORIGIN = new THREE.Vector3(0, -500000, 0);

export class LandingController {
  /**
   * @param {object} deps
   * @param {import('../scene/SceneManager.js').SceneManager} deps.sceneManager
   * @param {import('../ship/PlayerShip.js').PlayerShip} deps.playerShip
   * @param {import('../galaxy/GalaxyStreamer.js').GalaxyStreamer} deps.galaxyStreamer
   * @param {import('../ship/CargoHold.js').CargoHold} deps.cargoHold
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ sceneManager, playerShip, galaxyStreamer, cargoHold, eventBus }) {
    this.sceneManager = sceneManager;
    this.playerShip = playerShip;
    this.galaxyStreamer = galaxyStreamer;
    this.cargoHold = cargoHold;
    this.eventBus = eventBus;

    this.isLanded = false;
    this.currentSurface = null;
    /** 本帧检测到的、在降落范围内的最近行星（供 HUD 提示），仅在太空模式下有效 */
    this._nearestLandable = null;
    /** 降落前的太空状态快照，起飞时原样恢复 */
    this._savedSpaceState = null;

    this._tmpVec = new THREE.Vector3();
  }

  /** 供 HUD 判断是否显示"按 L 降落"提示 */
  get canLand() {
    return !this.isLanded && !!this._nearestLandable;
  }

  /**
   * @param {number} dt 秒
   * @param {import('../player/InputController.js').InputState} inputState
   */
  update(dt, inputState) {
    if (!this.isLanded) {
      this._updateSpaceMode(inputState);
    } else {
      this._updateSurfaceMode(dt, inputState);
    }
  }

  _updateSpaceMode(inputState) {
    this._nearestLandable = null;

    // 降落前必须减速到安全范围，防止高速状态下"砸"进地表
    const speed = this.playerShip.physics.velocity.length();
    if (speed > PlanetConfig.LANDING_MAX_SPEED) return;

    const nearby = this.galaxyStreamer.findNearbyPlanets(
      this.playerShip.object3D.position,
      PlanetConfig.LANDING_MAX_DISTANCE
    );
    if (nearby.length === 0) return;

    this._nearestLandable = nearby[0];

    if (inputState.landJustPressed) {
      this._land(nearby[0].data);
    }
  }

  /** @param {import('../galaxy/generation/GalaxyGenerator.js').PlanetData} planetData */
  _land(planetData) {
    this._savedSpaceState = {
      position: this.playerShip.object3D.position.clone(),
      quaternion: this.playerShip.object3D.quaternion.clone(),
      velocity: this.playerShip.physics.velocity.clone(),
    };

    this.currentSurface = generateSurface(planetData);
    this.currentSurface.group.position.copy(SURFACE_STAGE_ORIGIN);
    this.sceneManager.add(this.currentSurface.group, { updatable: this.currentSurface });

    const startHeight = this.currentSurface.heightAt(0, 0) + 18;
    this.playerShip.object3D.position.set(
      SURFACE_STAGE_ORIGIN.x,
      SURFACE_STAGE_ORIGIN.y + startHeight,
      SURFACE_STAGE_ORIGIN.z
    );
    this.playerShip.object3D.quaternion.identity();
    this.playerShip.physics.velocity.set(0, 0, 0);
    this.playerShip.physics.angularVelocity.set(0, 0, 0);
    this.playerShip.physics.throttle = 0.15;

    this.sceneManager.scene.background = new THREE.Color(this.currentSurface.palette.sky);
    this.sceneManager.scene.fog = new THREE.Fog(this.currentSurface.palette.fog, 40, 420);

    this.isLanded = true;
    this.eventBus.emit('planet:landed', { type: planetData.type });
  }

  _takeoff() {
    this.sceneManager.remove(this.currentSurface.group, { updatable: this.currentSurface });
    this.currentSurface.dispose();
    this.currentSurface = null;

    this.sceneManager.scene.background = null;
    this.sceneManager.scene.fog = null;

    this.playerShip.object3D.position.copy(this._savedSpaceState.position);
    this.playerShip.object3D.quaternion.copy(this._savedSpaceState.quaternion);
    this.playerShip.physics.velocity.copy(this._savedSpaceState.velocity);
    this._savedSpaceState = null;

    this.isLanded = false;
    this.eventBus.emit('planet:takeoff', {});
  }

  _updateSurfaceMode(dt, inputState) {
    if (inputState.landJustPressed) {
      this._takeoff();
      return;
    }

    const localX = this.playerShip.object3D.position.x - SURFACE_STAGE_ORIGIN.x;
    const localZ = this.playerShip.object3D.position.z - SURFACE_STAGE_ORIGIN.z;

    // 软边界：飞出地块范围时被推回，模拟"有限地块"的边界墙，
    // 同时吃掉一部分速度作为撞墙反馈
    const maxExtent = PlanetConfig.SURFACE_RADIUS - 10;
    const distFromCenter = Math.hypot(localX, localZ);
    let clampedX = localX;
    let clampedZ = localZ;
    if (distFromCenter > maxExtent) {
      const scale = maxExtent / distFromCenter;
      clampedX = localX * scale;
      clampedZ = localZ * scale;
      this.playerShip.object3D.position.x = SURFACE_STAGE_ORIGIN.x + clampedX;
      this.playerShip.object3D.position.z = SURFACE_STAGE_ORIGIN.z + clampedZ;
      this.playerShip.physics.velocity.multiplyScalar(0.4);
    }

    // 地面碰撞：不允许飞船钻进地形以下
    const groundHeight = this.currentSurface.heightAt(clampedX, clampedZ);
    const minY = SURFACE_STAGE_ORIGIN.y + groundHeight + 1.5;
    if (this.playerShip.object3D.position.y < minY) {
      this.playerShip.object3D.position.y = minY;
      if (this.playerShip.physics.velocity.y < 0) this.playerShip.physics.velocity.y = 0;
    }

    if (inputState.mineJustPressed) {
      this._tryMineNearest();
    }

    // 危险区域：连续伤害（dps * dt），而不是离散"打一下"，避免帧率波动导致伤害不一致
    for (const hazard of this.currentSurface.hazardZones) {
      const dist = Math.hypot(clampedX - hazard.x, clampedZ - hazard.z);
      if (dist <= hazard.radius) {
        this.playerShip.health.takeDamage(hazard.dps * dt, {
          sourceTag: 'hazard',
          worldPosition: this.playerShip.object3D.position.clone(),
        });
      }
    }
  }

  _tryMineNearest() {
    const shipPos = this.playerShip.object3D.position;
    let closest = null;
    let closestDist = Infinity;
    for (const node of this.currentSurface.resourceNodes) {
      if (node.depleted) continue;
      const dist = shipPos.distanceTo(node.mesh.getWorldPosition(this._tmpVec));
      if (dist < closestDist) {
        closestDist = dist;
        closest = node;
      }
    }
    if (!closest || closestDist > PlanetConfig.RESOURCE_PICKUP_RANGE) return;

    const result = closest.mine();
    if (!result) return;
    const { accepted, overflowed } = this.cargoHold.addResource(result.resourceId, result.amount);
    this.eventBus.emit('resource:mined', { resourceId: result.resourceId, accepted, overflowed });
  }
}
