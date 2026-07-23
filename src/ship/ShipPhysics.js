/**
 * ShipPhysics.js
 * ------------------------------------------------------------------
 * 功能：可复用的飞船飞行物理组件。Phase1 中这套「油门决定目标速度、
 *       姿态输入决定角速度、带阻尼」的手感被写死在 PlayerShip 内部；
 *       Phase2 需要敌人飞船（EnemyShip）复用完全相同的物理表现，
 *       因此抽取为独立组件，通过组合（composition）方式被
 *       PlayerShip 与 EnemyShip 共同持有，而不是让 EnemyShip 继承
 *       PlayerShip（继承会把「玩家特有」的 HUD/输入耦合进敌人逻辑，
 *       违反第二十四节的 SOLID/组合优先原则）。
 *       PlayerShip 对外的 update(dt, inputState) 契约保持不变。
 * 输入：
 *   - 构造：object3D: THREE.Object3D（外部持有并添加到场景的飞船根节点）
 *   - update(dt, inputState): dt 秒，inputState 见 InputController 的
 *     InputState typedef（EnemyAIController 会伪造同结构的输入喂给它）
 * 输出：this.telemetry { speed, throttle, boosting }，this.velocity
 * 调用关系：被 ship/PlayerShip.js 与 enemy/EnemyShip.js 持有
 * 复杂度：update() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { ShipPhysicsConfig } from '../config/GameConfig.js';
import { clamp, dampTowards } from '../utils/MathUtils.js';

export class ShipPhysics {
  /**
   * @param {THREE.Object3D} object3D 该物理组件驱动的世界节点
   * @param {{maxSpeedMultiplier?: number, initialThrottle?: number}} [options]
   *   maxSpeedMultiplier：不同船体/引擎模块未来可用于差异化最大速度
   *   （Phase6 飞船改装系统会用到），Phase2 敌人可用它做出「侦察艇更快/
   *   护卫舰更慢」的差异。
   */
  constructor(object3D, options = {}) {
    this.object3D = object3D;
    this.maxSpeedMultiplier = options.maxSpeedMultiplier ?? 1;

    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = new THREE.Vector3(0, 0, 0); // x=pitch, y=yaw, z=roll
    this.throttle = options.initialThrottle ?? 0.35;

    this.telemetry = {
      speed: 0,
      throttle: this.throttle,
      boosting: false,
    };

    // 复用临时对象，避免每帧 new，减少 GC 压力
    this._forward = new THREE.Vector3();
    this._localEuler = new THREE.Euler();
    this._deltaQuat = new THREE.Quaternion();
  }

  /**
   * 获取当前世界坐标下的机头朝向（单位向量，局部 -Z 方向）
   * 供武器系统计算发射方向、AI 计算瞄准误差使用
   * @returns {THREE.Vector3}
   */
  getForwardVector(target = new THREE.Vector3()) {
    return target.set(0, 0, -1).applyQuaternion(this.object3D.quaternion);
  }

  /**
   * 每帧更新飞船物理与朝向
   * @param {number} dt 秒
   * @param {import('../player/InputController.js').InputState} inputState
   */
  update(dt, inputState) {
    const cfg = ShipPhysicsConfig;

    this.angularVelocity.x = dampTowards(
      this.angularVelocity.x,
      inputState.pitch * cfg.PITCH_RATE,
      cfg.ANGULAR_DAMPING,
      dt
    );
    this.angularVelocity.y = dampTowards(
      this.angularVelocity.y,
      -inputState.yaw * cfg.YAW_RATE,
      cfg.ANGULAR_DAMPING,
      dt
    );
    this.angularVelocity.z = dampTowards(
      this.angularVelocity.z,
      inputState.roll * cfg.ROLL_RATE,
      cfg.ANGULAR_DAMPING,
      dt
    );

    this._localEuler.set(
      this.angularVelocity.x * dt,
      this.angularVelocity.y * dt,
      this.angularVelocity.z * dt,
      'YXZ'
    );
    this._deltaQuat.setFromEuler(this._localEuler);
    this.object3D.quaternion.multiply(this._deltaQuat);

    if (inputState.throttleDelta !== 0) {
      this.throttle = clamp(this.throttle + inputState.throttleDelta * 0.6 * dt, 0, 1);
    }

    const boosting = !!inputState.boost;
    const maxSpeed =
      cfg.MAX_LINEAR_SPEED * this.maxSpeedMultiplier * (boosting ? cfg.BOOST_MULTIPLIER : 1);
    const targetSpeed = this.throttle * maxSpeed;

    this.getForwardVector(this._forward);

    if (inputState.brake) {
      const damp = Math.exp(-cfg.BRAKE_DAMPING * dt);
      this.velocity.multiplyScalar(damp);
    } else {
      const currentForwardSpeed = this.velocity.dot(this._forward);
      const speedError = targetSpeed - currentForwardSpeed;
      const accel = clamp(speedError, -cfg.THRUST_ACCEL, cfg.THRUST_ACCEL) * dt;
      this.velocity.addScaledVector(this._forward, accel);

      const lateralDamp = Math.exp(-cfg.LINEAR_DAMPING * dt);
      const forwardComponent = this._forward
        .clone()
        .multiplyScalar(this.velocity.dot(this._forward));
      const lateralComponent = this.velocity.clone().sub(forwardComponent);
      lateralComponent.multiplyScalar(lateralDamp);
      this.velocity.copy(forwardComponent).add(lateralComponent);
    }

    const speed = this.velocity.length();
    if (speed > maxSpeed * 1.05 && speed > 0) {
      this.velocity.multiplyScalar((maxSpeed * 1.05) / speed);
    }

    this.object3D.position.addScaledVector(this.velocity, dt);

    this.telemetry.speed = this.velocity.length();
    this.telemetry.throttle = this.throttle;
    this.telemetry.boosting = boosting;
  }
}
