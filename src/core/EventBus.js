/**
 * EventBus.js
 * ------------------------------------------------------------------
 * 功能：全局事件总线，实现系统间解耦通信（例如：飞船受伤 -> UI 更新血条，
 *       无需 UI 模块直接引用飞船模块）。这是后续阵营系统、任务系统、
 *       经济系统互相通信的基础设施，必须保持零依赖、足够轻量。
 * 输入：
 *   - on(eventName, handler)      订阅事件
 *   - off(eventName, handler)     取消订阅
 *   - emit(eventName, payload)    广播事件
 * 输出：无返回值（副作用为触发已注册回调）
 * 调用关系：被 engine/Engine.js 创建为单例后，注入到几乎所有子系统
 * 复杂度：on/off 为 O(1)，emit 为 O(n)，n 为该事件的订阅者数量
 * ------------------------------------------------------------------
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} eventName
   * @param {(payload:any)=>void} handler
   * @returns {() => void} 取消订阅的函数，方便调用方直接持有
   */
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * 取消订阅
   * @param {string} eventName
   * @param {(payload:any)=>void} handler
   */
  off(eventName, handler) {
    const set = this._listeners.get(eventName);
    if (set) set.delete(handler);
  }

  /**
   * 广播事件给所有订阅者
   * @param {string} eventName
   * @param {any} [payload]
   */
  emit(eventName, payload) {
    const set = this._listeners.get(eventName);
    if (!set || set.size === 0) return;
    // 复制一份再迭代，防止回调内部 on/off 导致迭代期间集合变化
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        // 单个订阅者报错不应打断其它订阅者，也不应打断游戏循环
        console.error(`[EventBus] handler for "${eventName}" threw:`, err);
      }
    }
  }

  /** 清空所有订阅，主要用于场景切换/重载时的内存清理 */
  clear() {
    this._listeners.clear();
  }
}
