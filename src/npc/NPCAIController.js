/**
 * NPCAIController.js
 * ------------------------------------------------------------------
 * 功能：银河环境 NPC（运输船/商船/巡逻舰等）的自动驾驶。和
 *       enemy/EnemyAIController 不同，这里没有状态机——NPC 不会攻击
 *       玩家，也不会因为玩家的存在改变行为，只是在自己出生扇区内的
 *       若干航点之间循环巡航，营造「银河里飞来飞去的不只是敌人」的
 *       氛围（需求文档「九、NPC系统」）。转向计算复用与
 *       enemy/EnemyAIController 完全相同的比例自动驾驶数学（同一套
 *       符号约定，已经在 Phase2 验证过正确性），但转弯更柔和、
 *       没有包抄/逃跑之类的战斗机动。
 *       真正有意义的 NPC 行为——运输船在站点间实际运货、遭遇战/护航、
 *       声望影响——需要任务系统和阵营关系打底，属于 Phase5+ 范畴，
 *       Phase4 先把「银河看起来是活的」这一层做扎实。
 * 输入：
 *   - 构造：waypoints: THREE.Vector3[]（至少 1 个，世界坐标）
 *   - decide(dt, selfObject3D)
 * 输出：{ pitch, yaw, roll, throttle }——与 ShipPhysics 的控制信号同构，
 *       可以直接喂给 ShipPhysics.update()
 * 调用关系：被 npc/NPCShip.js 持有并驱动
 * 复杂度：decide() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { NPCConfig } from '../config/GameConfig.js';
import { clamp } from '../utils/MathUtils.js';

export class NPCAIController {
  /** @param {THREE.Vector3[]} waypoints */
  constructor(waypoints) {
    this.waypoints = waypoints;
    this._targetIndex = 0;

    this._tmpLocalDir = new THREE.Vector3();
    this._tmpInvQuat = new THREE.Quaternion();
  }

  /**
   * @param {number} dt
   * @param {THREE.Object3D} selfObject3D
   * @returns {{pitch:number, yaw:number, roll:number, throttle:number}}
   */
  decide(dt, selfObject3D) {
    const target = this.waypoints[this._targetIndex];
    if (selfObject3D.position.distanceTo(target) < NPCConfig.WAYPOINT_ARRIVAL_DISTANCE) {
      this._targetIndex = (this._targetIndex + 1) % this.waypoints.length;
    }

    const steer = this._computeSteering(selfObject3D, this.waypoints[this._targetIndex]);
    return {
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      throttle: NPCConfig.CRUISE_THROTTLE,
    };
  }

  /** 与 EnemyAIController 相同的比例自动驾驶数学，符号约定完全一致 */
  _computeSteering(selfObject3D, worldPoint) {
    this._tmpInvQuat.copy(selfObject3D.quaternion).invert();
    this._tmpLocalDir
      .copy(worldPoint)
      .sub(selfObject3D.position)
      .applyQuaternion(this._tmpInvQuat)
      .normalize();

    const yawAngle = Math.atan2(this._tmpLocalDir.x, -this._tmpLocalDir.z);
    const pitchAngle = Math.atan2(this._tmpLocalDir.y, -this._tmpLocalDir.z);

    const maxAngle = NPCConfig.STEER_MAX_ANGLE;
    const yaw = clamp(yawAngle / maxAngle, -1, 1);
    const pitch = clamp(pitchAngle / maxAngle, -1, 1);
    const roll = clamp(yaw * 0.6, -1, 1); // NPC 转弯压坡度比战斗 AI 更柔和

    return { pitch, yaw, roll };
  }
}
