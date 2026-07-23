/**
 * GameLoop.js
 * ------------------------------------------------------------------
 * 功能：基于 requestAnimationFrame 的主循环，负责计算帧间 deltaTime，
 *       并在每一帧依次调用「更新回调」与「渲染回调」。对 deltaTime 做
 *       上限截断，避免切后台标签页恢复时因超大 dt 导致物理穿模/爆炸。
 * 输入：
 *   - update(dt: number)  每帧逻辑更新回调（dt 单位：秒）
 *   - render()             每帧渲染回调
 * 输出：无（通过回调驱动整个游戏世界前进）
 * 调用关系：由 engine/Engine.js 创建并持有；不直接依赖 Three.js，
 *           因此可以被单元测试或未来替换为 WebWorker 版本
 * 复杂度：每帧 O(1)，实际复杂度取决于 update/render 回调内部逻辑
 * ------------------------------------------------------------------
 */
export class GameLoop {
  /**
   * @param {(dt:number)=>void} updateFn
   * @param {()=>void} renderFn
   */
  constructor(updateFn, renderFn) {
    this._update = updateFn;
    this._render = renderFn;
    this._running = false;
    this._lastTime = 0;
    this._rafHandle = null;

    // deltaTime 上限（秒），防止切后台恢复时物理系统瞬间获得超大 dt
    this.MAX_DT = 1 / 15;

    // 供 HUD/调试面板读取的运行期统计
    this.stats = {
      fps: 0,
      frameCount: 0,
      elapsed: 0,
    };

    this._tick = this._tick.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._rafHandle = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  /**
   * 内部帧驱动函数
   * @param {number} now 由 rAF 传入的高精度时间戳（毫秒）
   */
  _tick(now) {
    if (!this._running) return;

    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > this.MAX_DT) dt = this.MAX_DT;
    if (dt < 0) dt = 0; // 防御性处理，理论上不应发生

    this._update(dt);
    this._render();

    // 简单的滑动 FPS 统计，供性能面板/调试 HUD 使用
    this.stats.frameCount += 1;
    this.stats.elapsed += dt;
    if (this.stats.elapsed >= 0.5) {
      this.stats.fps = Math.round(this.stats.frameCount / this.stats.elapsed);
      this.stats.frameCount = 0;
      this.stats.elapsed = 0;
    }

    this._rafHandle = requestAnimationFrame(this._tick);
  }
}
