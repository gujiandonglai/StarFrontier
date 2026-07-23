/**
 * CameraRig.js
 * ------------------------------------------------------------------
 * 功能：第三人称追踪摄像机。以飞船局部坐标系中的固定偏移点为「理想位置」，
 *       每帧向该理想位置与理想朝向做帧率无关的指数平滑插值，避免生硬跟随
 *       或过度延迟。加速/冲刺时轻微增加 FOV，增强速度感（对应需求文档
 *       「二十一、画面」中的动态镜头需求的雏形）。
 * 输入：
 *   - 构造：camera: THREE.PerspectiveCamera
 *   - update(dt, targetObject3D, telemetry)
 * 输出：无返回值，直接修改传入 camera 的 position/quaternion/fov
 * 调用关系：由 main.js 创建，每帧传入 PlayerShip.object3D 与
 *           PlayerShip.telemetry
 * 复杂度：O(1) 每帧
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { CameraRigConfig, ShipPhysicsConfig } from '../config/GameConfig.js';
import { dampTowards } from '../utils/MathUtils.js';

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(camera) {
    this.camera = camera;
    this._baseFov = camera.fov;

    this._idealPosition = new THREE.Vector3();
    this._idealLookAt = new THREE.Vector3();
    this._currentLookAt = new THREE.Vector3();
    this._offsetWorld = new THREE.Vector3();
  }

  /**
   * @param {number} dt 秒
   * @param {THREE.Object3D} target 跟随目标（通常是 PlayerShip.object3D）
   * @param {{speed:number, boosting:boolean}} telemetry 用于 FOV 速度感反馈
   */
  update(dt, target, telemetry) {
    const cfg = CameraRigConfig;

    // 将局部偏移转换到世界坐标：目标位置 + (偏移向量经过目标朝向旋转)
    this._offsetWorld
      .set(cfg.OFFSET.x, cfg.OFFSET.y, cfg.OFFSET.z)
      .applyQuaternion(target.quaternion);
    this._idealPosition.copy(target.position).add(this._offsetWorld);

    this.camera.position.x = dampTowards(
      this.camera.position.x,
      this._idealPosition.x,
      cfg.POSITION_LERP,
      dt
    );
    this.camera.position.y = dampTowards(
      this.camera.position.y,
      this._idealPosition.y,
      cfg.POSITION_LERP,
      dt
    );
    this.camera.position.z = dampTowards(
      this.camera.position.z,
      this._idealPosition.z,
      cfg.POSITION_LERP,
      dt
    );

    // 注视点：目标前方一定距离处，制造「追焦」的运镜感
    this._idealLookAt
      .set(0, 0, -cfg.LOOK_AHEAD)
      .applyQuaternion(target.quaternion)
      .add(target.position);

    this._currentLookAt.x = dampTowards(
      this._currentLookAt.x || this._idealLookAt.x,
      this._idealLookAt.x,
      cfg.ROTATION_SLERP,
      dt
    );
    this._currentLookAt.y = dampTowards(
      this._currentLookAt.y || this._idealLookAt.y,
      this._idealLookAt.y,
      cfg.ROTATION_SLERP,
      dt
    );
    this._currentLookAt.z = dampTowards(
      this._currentLookAt.z || this._idealLookAt.z,
      this._idealLookAt.z,
      cfg.ROTATION_SLERP,
      dt
    );

    this.camera.up.set(0, 1, 0).applyQuaternion(target.quaternion);
    this.camera.lookAt(this._currentLookAt);

    // 速度感 FOV kick
    const speedRatio = telemetry
      ? Math.min(telemetry.speed / ShipPhysicsConfig.MAX_LINEAR_SPEED, 1.5)
      : 0;
    const targetFov =
      this._baseFov + speedRatio * cfg.FOV_BOOST_KICK + (telemetry?.boosting ? 4 : 0);
    this.camera.fov = dampTowards(this.camera.fov, targetFov, 3.0, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 立即把摄像机"传送"到目标飞船的理想跟随位置，跳过指数平滑插值。
   * 用于读档这类"瞬间换到新位置"的场景——如果没有这个方法，摄像机会
   * 在原来的位置（比如世界原点附近）用正常跟随速度花几秒"飞"过去追上
   * 传送到别处的飞船，非常违和。复用与 update() 完全相同的偏移量计算。
   * @param {THREE.Object3D} target
   */
  snapTo(target) {
    const cfg = CameraRigConfig;

    this._offsetWorld.set(cfg.OFFSET.x, cfg.OFFSET.y, cfg.OFFSET.z).applyQuaternion(target.quaternion);
    this.camera.position.copy(target.position).add(this._offsetWorld);

    this._idealLookAt
      .set(0, 0, -cfg.LOOK_AHEAD)
      .applyQuaternion(target.quaternion)
      .add(target.position);
    this._currentLookAt.copy(this._idealLookAt);

    this.camera.up.set(0, 1, 0).applyQuaternion(target.quaternion);
    this.camera.lookAt(this._currentLookAt);
  }
}
