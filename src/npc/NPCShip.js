/**
 * NPCShip.js
 * ------------------------------------------------------------------
 * 功能：银河环境 NPC 实体——非战斗、不可攻击、不会攻击玩家的运输船/
 *       巡逻舰，纯粹为了让银河「看起来是活的」（需求文档「九、NPC系统」：
 *       运输船/商船/游客/巡逻舰/矿船……不只是敌人在飞）。复用飞船通用的
 *       ShipPhysics 飞行模型（和玩家/敌人同一套物理，只是速度上限更低），
 *       但不持有 Health/Collider/WeaponSystem——Phase4 的 NPC 是背景
 *       氛围而不是可攻击实体。让 NPC 可被攻击需要声望后果（否则玩家
 *       打平民没有任何代价，反而变相鼓励破坏性玩法），那部分逻辑需要
 *       Phase5 阵营系统打底，此处刻意不提前实现。
 *       视觉造型故意和玩家（青色）、敌人（红色）区分开，用中性的
 *       米黄/白色调，一眼就能看出"这是平民船，不是威胁"。
 * 输入：
 *   - 构造：{ spawnPosition, waypoints }
 *   - update(dt)（自包含，不需要外部传入目标——符合 SceneManager 的
 *     updatable 注册模式，可以像 Starfield/ParticleSystem 一样直接
 *     挂进场景，main.js 不需要单独维护一份 NPC 数组来手动驱动它）
 * 输出：this.object3D
 * 调用关系：由 galaxy/GalaxyStreamer.js 在扇区加载/卸载时批量创建/销毁
 * 复杂度：update() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { NPCConfig } from '../config/GameConfig.js';
import { ShipPhysics } from '../ship/ShipPhysics.js';
import { NPCAIController } from './NPCAIController.js';

export class NPCShip {
  /**
   * @param {object} config
   * @param {THREE.Vector3} config.spawnPosition
   * @param {THREE.Vector3[]} config.waypoints 世界坐标航点列表，至少 1 个
   */
  constructor({ spawnPosition, waypoints }) {
    this.object3D = this._buildMesh();
    this.object3D.position.copy(spawnPosition);

    this.physics = new ShipPhysics(this.object3D, {
      maxSpeedMultiplier: NPCConfig.MAX_SPEED_MULTIPLIER,
      initialThrottle: NPCConfig.CRUISE_THROTTLE,
    });

    this.ai = new NPCAIController(waypoints);
  }

  /**
   * 占位外观：六棱柱主货舱 + 两侧吊舱，故意比战斗机更「笨重方正」，
   * 一眼能看出是运输船而不是战斗单位。
   * @returns {THREE.Group}
   */
  _buildMesh() {
    const group = new THREE.Group();
    group.name = 'NPCShip';

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xd8cdb8,
      metalness: 0.4,
      roughness: 0.6,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xffe28a,
      emissive: 0xffe28a,
      emissiveIntensity: 1.0,
      metalness: 0.2,
      roughness: 0.5,
    });

    const bodyGeo = new THREE.CylinderGeometry(1.6, 1.6, 5.5, 6);
    const body = new THREE.Mesh(bodyGeo, hullMat);
    body.rotation.x = -Math.PI / 2; // 沿用全项目统一约定：局部 -Z 为前方
    group.add(body);

    const podGeo = new THREE.BoxGeometry(1.4, 1.4, 3.2);
    const podL = new THREE.Mesh(podGeo, hullMat);
    podL.position.set(-2.4, 0, 0.4);
    const podR = podL.clone();
    podR.position.x = 2.4;
    group.add(podL, podR);

    const engineGeo = new THREE.SphereGeometry(0.32, 10, 10);
    const engineL = new THREE.Mesh(engineGeo, accentMat);
    engineL.position.set(-2.4, 0, 2.6);
    const engineR = engineL.clone();
    engineR.position.x = 2.4;
    group.add(engineL, engineR);

    return group;
  }

  /** @param {number} dt 秒 */
  update(dt) {
    const control = this.ai.decide(dt, this.object3D);
    this.physics.throttle = control.throttle;
    this.physics.update(dt, {
      pitch: control.pitch,
      yaw: control.yaw,
      roll: control.roll,
      boost: false,
      brake: false,
      throttleDelta: 0,
    });
  }
}
