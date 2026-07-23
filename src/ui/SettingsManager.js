/**
 * SettingsManager.js
 * ------------------------------------------------------------------
 * 功能：玩家偏好设置（操作/图形/HUD）的读写与持久化。故意使用
 *       localStorage 而不是 IndexedDB——需求文档明确要求「存档系统
 *       必须使用 IndexedDB」，但那指的是「游戏进度」（飞船状态/声望/
 *       任务……），不是这种几个开关和滑块量级的小型偏好数据。
 *       localStorage 是同步 API，不需要处理 Promise/事务，对这种体量
 *       的数据反而更合适，两者不是同一个概念，不应该混用同一套持久化
 *       机制。
 * 输入：无参数构造（构造时自动从 localStorage 读取，缺失字段用默认值填充）
 * 输出：this.values：当前设置对象；set(key, value)：更新并立即持久化
 * 调用关系：由 main.js 创建单例；设置面板 UI 读取 values 渲染控件、
 *          调用 set() 响应用户交互；main.js 把 values 应用到
 *          InputController/RendererManager/Starfield/HUD 等具体系统上
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

const STORAGE_KEY = 'starfrontier.settings.v1';

/** 所有设置项的默认值——新增设置项只需要在这里加一条，旧存档缺失的字段会自动补上默认值 */
const DEFAULT_SETTINGS = Object.freeze({
  invertPitch: false,
  hudOpacity: 1.0, // 0.4~1.0
  graphicsQuality: 'high', // 'low' | 'medium' | 'high'
  showMinimap: true,
  autosaveEnabled: true,
});

// 图形质量档位 -> 具体参数（星空密度倍率 / 像素比上限）
const GRAPHICS_QUALITY_PRESETS = Object.freeze({
  low: { starfieldDensity: 0.35, pixelRatioCap: 1.0 },
  medium: { starfieldDensity: 0.7, pixelRatioCap: 1.5 },
  high: { starfieldDensity: 1.0, pixelRatioCap: 2.0 },
});

export class SettingsManager {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...this._loadRaw() };
  }

  _loadRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      // 隐私模式/存储被禁用等情况下 localStorage 可能抛错，静默降级为默认设置，
      // 不应该因为读设置失败就让整个游戏无法启动
      console.warn('[SettingsManager] 读取设置失败，使用默认值', err);
      return {};
    }
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch (err) {
      console.warn('[SettingsManager] 保存设置失败', err);
    }
  }

  /**
   * @param {string} key DEFAULT_SETTINGS 中的字段名
   * @param {*} value
   */
  set(key, value) {
    this.values[key] = value;
    this._persist();
  }

  /** @returns {{starfieldDensity:number, pixelRatioCap:number}} */
  getGraphicsPreset() {
    return GRAPHICS_QUALITY_PRESETS[this.values.graphicsQuality] || GRAPHICS_QUALITY_PRESETS.high;
  }
}
