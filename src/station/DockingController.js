/**
 * DockingController.js
 * ------------------------------------------------------------------
 * 功能：空间站对接的状态机。和 planet/LandingController 不同，对接不需要
 *       切换场景——空间站本来就渲染在原地，靠近减速后按 K 对接，飞船
 *       原地"停靠"（清零速度，main.js 会在对接期间跳过飞行输入更新），
 *       弹出商店面板；再按 K 或点击面板上的"离开"按钮解除对接，恢复
 *       正常飞行。真正的买卖/维修逻辑交给 economy/Market.js 与 Health，
 *       DockingController 只负责状态切换与"离玩家最近的可对接站点是谁"。
 *       与降落系统的互斥不需要额外判断：飞船降落后会被搬到远离银河
 *       扇区网格的地表舞台坐标（见 LandingController），此时
 *       findNearbyStations() 自然找不到任何站点，对接提示也就不会出现，
 *       两个系统靠"物理距离"自然互斥，不需要互相查询对方的状态。
 * 输入：
 *   - 构造：{ playerShip, galaxyStreamer, eventBus }
 *   - update(dt, inputState)：每帧调用
 * 输出：this.isDocked；this.canDock（供 HUD 显示"按 K 对接"提示）；
 *       this.dockedStation（含 market，供商店面板读取）
 * 调用关系：由 main.js 创建并驱动；main.js 在 isDocked 为 true 时跳过
 *           飞船的飞行输入更新（但仍然渲染画面、显示商店面板）
 * 复杂度：update() 为 O(附近扇区站点数)，通常只有 0~1 个
 * ------------------------------------------------------------------
 */
import { StationConfig } from '../config/GameConfig.js';

// 找候选站点时用的粗筛半径；真正能否对接还要看每个站点自己的 dockingRadius
const STATION_SEARCH_RADIUS = 260;

export class DockingController {
  /**
   * @param {object} deps
   * @param {import('../ship/PlayerShip.js').PlayerShip} deps.playerShip
   * @param {import('../galaxy/GalaxyStreamer.js').GalaxyStreamer} deps.galaxyStreamer
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ playerShip, galaxyStreamer, eventBus }) {
    this.playerShip = playerShip;
    this.galaxyStreamer = galaxyStreamer;
    this.eventBus = eventBus;

    this.isDocked = false;
    /** @type {{position:import('three').Vector3, data:object, stationInstance:object}|null} */
    this.dockedStation = null;
    this._nearestDockable = null;
  }

  /** 供 HUD 判断是否显示"按 K 对接"提示 */
  get canDock() {
    return !this.isDocked && !!this._nearestDockable;
  }

  /**
   * @param {number} dt
   * @param {import('../player/InputController.js').InputState} inputState
   */
  update(dt, inputState) {
    if (!this.isDocked) {
      this._updateUndocked(inputState);
    } else if (inputState.dockJustPressed) {
      this.undock();
    }
  }

  _updateUndocked(inputState) {
    this._nearestDockable = null;

    const speed = this.playerShip.physics.velocity.length();
    if (speed > StationConfig.DOCKING_MAX_SPEED) return;

    const nearby = this.galaxyStreamer.findNearbyStations(
      this.playerShip.object3D.position,
      STATION_SEARCH_RADIUS
    );
    if (nearby.length === 0) return;

    let closest = null;
    let closestDist = Infinity;
    for (const candidate of nearby) {
      const dist = this.playerShip.object3D.position.distanceTo(candidate.position);
      if (dist < closestDist) {
        closestDist = dist;
        closest = candidate;
      }
    }

    if (closest && closestDist <= closest.data.dockingRadius) {
      this._nearestDockable = closest;
      if (inputState.dockJustPressed) {
        this._dock(closest);
      }
    }
  }

  _dock(station) {
    this.isDocked = true;
    this.dockedStation = station;

    this.playerShip.physics.velocity.set(0, 0, 0);
    this.playerShip.physics.angularVelocity.set(0, 0, 0);
    this.playerShip.physics.throttle = 0;

    this.eventBus.emit('station:docked', { name: station.data.name });
  }

  undock() {
    this.isDocked = false;
    this.dockedStation = null;
    this.eventBus.emit('station:undocked', {});
  }
}
