/**
 * EnemyAIController.js
 * ------------------------------------------------------------------
 * 功能：有限状态机（Patrol / Chase / Attack / Flee）驱动的敌人自动驾驶。
 *       每帧根据战场态势输出一份与 InputController.InputState 同构的
 *       「控制信号」（pitch/yaw/roll/boost），交给共享的 ShipPhysics
 *       执行——这正是 ShipPhysics 注释中提到的「EnemyAIController 会
 *       伪造同结构的输入喂给它」的具体实现，玩家与敌人复用完全相同的
 *       飞行手感与武器系统，只是控制信号的来源不同。
 *       状态对应需求文档「十四、AI」的要求：
 *         PATROL -> 巡逻（出生点附近游走，未发现玩家）
 *         CHASE  -> 追踪（发现玩家，直线接近）
 *         ATTACK -> 包抄（进入交战距离后瞄准目标侧翼盘旋点，而非径直怼脸）
 *         FLEE   -> 逃跑（船体低于阈值，冲刺撤退）
 *       另外通过 EventBus 广播/监听 'ai:call-for-help'：敌机首次发现
 *       玩家时广播自身巡逻锚点位置，处于 PATROL 状态且锚点在广播半径内
 *       的友军会跳过独立索敌直接转入 CHASE——这是一个轻量版的「请求支援」。
 *       Phase8 起，ATTACK 状态的盘旋点由固定的"左/右"二选一（_orbitSign）
 *       升级为任意角度（attackAngle，构造时可选传入）——同一队（squad）
 *       的僚机会被 enemy/EnemyShip.js 分配到均匀分布的不同角度，围攻时
 *       自然从不同方向包抄，而不是排队挤在目标同一侧；未指定角度的
 *       独狼海盗则用完全随机的角度（比旧版"非左即右"更自然）。
 *       多机协同集火瞄准、能量管理、真正的编队跟随飞行仍然不在本阶段
 *       范围内——那需要更复杂的僚机跟随/领队让位逻辑，价值与实现成本
 *       不成比例，"围攻角度错开"已经能让玩家明显感觉到"这是一队敌人
 *       在配合"，是投入产出比更高的取舍。
 * 输入：
 *   - 构造：{ eventBus, patrolAnchor, attackAngle? }
 *   - decide(dt, context) 见下方 JSDoc
 * 输出：{ pitch, yaw, roll, boost, throttle, firePrimary }
 * 调用关系：被 enemy/EnemyShip.js 持有并驱动
 * 复杂度：decide() 为 O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { EnemyAIConfig } from '../config/GameConfig.js';
import { clamp } from '../utils/MathUtils.js';

export const AIState = Object.freeze({
  PATROL: 'PATROL',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  FLEE: 'FLEE',
});

let _instanceCounter = 0;

export class EnemyAIController {
  /**
   * @param {object} config
   * @param {import('../core/EventBus.js').EventBus} config.eventBus
   * @param {THREE.Vector3} config.patrolAnchor 出生点，巡逻游走与友军呼叫的参照锚点
   * @param {number} [config.attackAngle] ATTACK 状态盘旋点相对目标的固定角度（弧度）；
   *        不传则随机生成——供 enemy/EnemyShip.js 给同队僚机分配不同角度实现包抄
   */
  constructor({ eventBus, patrolAnchor, attackAngle }) {
    this.eventBus = eventBus;
    this.patrolAnchor = patrolAnchor.clone();
    this.state = AIState.PATROL;
    this.instanceId = ++_instanceCounter;

    this._patrolTarget = this._pickPatrolPoint();
    this._attackAngle = typeof attackAngle === 'number' ? attackAngle : Math.random() * Math.PI * 2;

    // 复用的临时对象，避免每帧 new，减少 GC 压力
    this._tmpToTarget = new THREE.Vector3();
    this._tmpLocalDir = new THREE.Vector3();
    this._tmpInvQuat = new THREE.Quaternion();
    this._tmpStrafeTarget = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpTargetForward = new THREE.Vector3();
    this._tmpForward = new THREE.Vector3();

    this._unsubscribeHelp = eventBus.on('ai:call-for-help', (payload) =>
      this._onCallForHelp(payload)
    );
  }

  /** 在出生锚点附近的球形范围内随机取一个巡逻游走点 */
  _pickPatrolPoint() {
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.5) * 0.6;
    const radius = EnemyAIConfig.PATROL_RADIUS * (0.4 + 0.6 * Math.random());
    return this.patrolAnchor.clone().add(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(elevation) * radius * 0.3,
        Math.sin(angle) * radius
      )
    );
  }

  _onCallForHelp(payload) {
    if (this.state !== AIState.PATROL) return; // 已经在交战/撤离的不受呼叫影响
    if (payload.instanceId === this.instanceId) return;
    const dist = this.patrolAnchor.distanceTo(payload.position);
    if (dist <= EnemyAIConfig.CALL_FOR_HELP_RADIUS) {
      this.state = AIState.CHASE;
    }
  }

  /**
   * @param {number} dt 秒
   * @param {object} context
   * @param {THREE.Object3D} context.selfObject3D
   * @param {import('../ship/Health.js').Health} context.selfHealth
   * @param {THREE.Object3D|null} context.targetObject3D 玩家飞船节点
   * @param {boolean} context.targetDestroyed 玩家是否已阵亡
   * @returns {{pitch:number, yaw:number, roll:number, boost:boolean, throttle:number, firePrimary:boolean}}
   */
  decide(dt, context) {
    const cfg = EnemyAIConfig;
    const { selfObject3D, selfHealth, targetObject3D, targetDestroyed } = context;

    const hasTarget = !!targetObject3D && !targetDestroyed;
    const distanceToTarget = hasTarget
      ? selfObject3D.position.distanceTo(targetObject3D.position)
      : Infinity;

    this._updateState(distanceToTarget, selfHealth, hasTarget);

    let steerPoint;
    let throttle;
    let boost = false;
    let firePrimary = false;

    switch (this.state) {
      case AIState.PATROL: {
        if (selfObject3D.position.distanceTo(this._patrolTarget) < 12) {
          this._patrolTarget = this._pickPatrolPoint();
        }
        steerPoint = this._patrolTarget;
        throttle = cfg.THROTTLE_PATROL;
        break;
      }
      case AIState.CHASE: {
        steerPoint = targetObject3D.position;
        throttle = cfg.THROTTLE_CHASE;
        break;
      }
      case AIState.ATTACK: {
        // 包抄：不直接对准目标本体，而是瞄准目标周围一个固定角度
        // （this._attackAngle）的盘旋点，一边保持交战距离一边侧向绕行。
        // 同队僚机会被分配不同角度（见 enemy/EnemyShip.js），自然从
        // 不同方向包抄，而不是排队挤在目标同一侧
        this._tmpRight.set(1, 0, 0).applyQuaternion(targetObject3D.quaternion);
        this._tmpTargetForward.set(0, 0, -1).applyQuaternion(targetObject3D.quaternion);
        this._tmpStrafeTarget
          .copy(targetObject3D.position)
          .addScaledVector(this._tmpRight, Math.cos(this._attackAngle) * cfg.ATTACK_RANGE * 0.5)
          .addScaledVector(this._tmpTargetForward, Math.sin(this._attackAngle) * cfg.ATTACK_RANGE * 0.5);
        steerPoint = this._tmpStrafeTarget;
        throttle = cfg.THROTTLE_ATTACK;

        const aimError = this._angleToTarget(selfObject3D, targetObject3D.position);
        firePrimary = aimError < cfg.AIM_TOLERANCE_RAD;
        break;
      }
      case AIState.FLEE: {
        this._tmpToTarget.copy(selfObject3D.position).sub(targetObject3D.position).normalize();
        this._tmpStrafeTarget.copy(selfObject3D.position).addScaledVector(this._tmpToTarget, 200);
        steerPoint = this._tmpStrafeTarget;
        throttle = cfg.THROTTLE_FLEE;
        boost = true;
        break;
      }
    }

    const steer = this._computeSteering(selfObject3D, steerPoint);

    return {
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      boost,
      throttle,
      firePrimary,
    };
  }

  /** 根据距离与船体比例驱动状态转换 */
  _updateState(distanceToTarget, selfHealth, hasTarget) {
    const cfg = EnemyAIConfig;

    if (hasTarget && selfHealth.hullRatio <= cfg.FLEE_HULL_RATIO) {
      this.state = AIState.FLEE;
      return;
    }

    switch (this.state) {
      case AIState.PATROL:
        if (hasTarget && distanceToTarget <= cfg.DETECTION_RANGE) {
          this.state = AIState.CHASE;
          this.eventBus.emit('ai:call-for-help', {
            instanceId: this.instanceId,
            position: this.patrolAnchor.clone(),
          });
        }
        break;
      case AIState.CHASE:
        if (!hasTarget || distanceToTarget > cfg.DISENGAGE_RANGE) {
          this.state = AIState.PATROL;
          this._patrolTarget = this._pickPatrolPoint();
        } else if (distanceToTarget <= cfg.ATTACK_RANGE) {
          this.state = AIState.ATTACK;
        }
        break;
      case AIState.ATTACK:
        if (!hasTarget || distanceToTarget > cfg.DISENGAGE_RANGE) {
          this.state = AIState.PATROL;
          this._patrolTarget = this._pickPatrolPoint();
        } else if (distanceToTarget > cfg.ATTACK_RANGE * 1.3) {
          this.state = AIState.CHASE;
        }
        break;
      case AIState.FLEE:
        if (!hasTarget || distanceToTarget > cfg.DISENGAGE_RANGE) {
          this.state = AIState.PATROL;
          this._patrolTarget = this._pickPatrolPoint();
        }
        break;
    }
  }

  /**
   * 比例自动驾驶：把「飞向 worldPoint」转换为 pitch/yaw/roll 控制信号。
   * 符号约定与 InputController/ShipPhysics 完全一致（yaw=+1 意为向右转，
   * ShipPhysics 内部会对 yaw 取负号换算成正确的角速度方向），因此这里
   * 输出的信号可以直接喂给 ShipPhysics.update()，无需任何额外转换。
   */
  _computeSteering(selfObject3D, worldPoint) {
    this._tmpInvQuat.copy(selfObject3D.quaternion).invert();
    this._tmpLocalDir
      .copy(worldPoint)
      .sub(selfObject3D.position)
      .applyQuaternion(this._tmpInvQuat)
      .normalize();

    const yawAngle = Math.atan2(this._tmpLocalDir.x, -this._tmpLocalDir.z);
    const pitchAngle = Math.atan2(this._tmpLocalDir.y, -this._tmpLocalDir.z);

    const MAX_STEER_ANGLE = Math.PI / 3; // 超过 60° 视为满舵输入
    const yaw = clamp(yawAngle / MAX_STEER_ANGLE, -1, 1);
    const pitch = clamp(pitchAngle / MAX_STEER_ANGLE, -1, 1);
    const roll = clamp(yaw * 0.8, -1, 1); // 简化的转弯压坡度（bank into turn）

    return { pitch, yaw, roll };
  }

  /** 机头方向与目标方向的夹角（弧度），供开火判定使用 */
  _angleToTarget(selfObject3D, worldPoint) {
    this._tmpToTarget.copy(worldPoint).sub(selfObject3D.position).normalize();
    this._tmpForward.set(0, 0, -1).applyQuaternion(selfObject3D.quaternion);
    return this._tmpForward.angleTo(this._tmpToTarget);
  }

  dispose() {
    this._unsubscribeHelp?.();
  }
}
