/**
 * InputController.js
 * ------------------------------------------------------------------
 * 功能：监听键盘与鼠标事件，维护当前输入状态，并将其翻译为标准化的
 *       飞行输入向量（pitch/yaw/roll 为 -1~1，boost/brake 为布尔值，
 *       throttle 为 0~1）、开火扳机状态（primary/secondary），以及
 *       Phase3 新增的「按一下触发一次」动作键（降落切换/采矿）。
 *       后者与持续读取的按住状态不同，需要做边沿检测（justPressed）——
 *       否则玩家按住 L 键不放，会在降落的同一帧里被立刻当成又按了一次
 *       从而马上起飞，体验完全错乱。
 * 输入：无参数构造；内部监听 window 的 keydown/keyup/mousedown/mouseup
 * 输出：getState() 返回当前帧的 InputState 对象（见下方 JSDoc typedef）
 * 调用关系：由 main.js 创建，每帧调用一次 getState() 后分发给
 *           PlayerShip.update() 与 LandingController.update()
 * 复杂度：事件回调 O(1)；getState() O(1)
 * ------------------------------------------------------------------
 */
import { InputConfig } from '../config/GameConfig.js';

/**
 * @typedef {Object} InputState
 * @property {number} pitch  -1（俯）~ 1（仰）
 * @property {number} yaw    -1（左）~ 1（右）
 * @property {number} roll   -1（左滚）~ 1（右滚）
 * @property {boolean} boost 是否加速冲刺
 * @property {boolean} brake 是否刹车
 * @property {number} throttleDelta 每帧油门增量方向：-1/0/1
 * @property {{primary: boolean, secondary: boolean}} triggers 开火扳机状态
 * @property {boolean} landJustPressed 降落/起飞切换键本帧是否刚按下（边沿触发）
 * @property {boolean} mineJustPressed 采矿键本帧是否刚按下（边沿触发）
 * @property {boolean} dockJustPressed 对接/解除对接切换键本帧是否刚按下（边沿触发）
 */

export class InputController {
  constructor() {
    /** @type {Set<string>} */
    this._keysDown = new Set();
    this._mouseDown = new Set();
    /** 上一帧的按键快照，用于计算 justPressed 边沿触发 */
    this._prevKeysDown = new Set();
    /** Phase7：Y 轴反转设置，由 ui/SettingsManager.js 持久化的偏好驱动 */
    this._invertPitch = false;

    this._onKeyDown = (e) => this._keysDown.add(e.code);
    this._onKeyUp = (e) => this._keysDown.delete(e.code);
    this._onMouseDown = (e) => this._mouseDown.add(e.button);
    this._onMouseUp = (e) => this._mouseDown.delete(e.button);
    // 阻止右键菜单/中键自动滚动等干扰飞行操作的默认浏览器行为
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  /** @param {boolean} value */
  setInvertPitch(value) {
    this._invertPitch = !!value;
  }

  _isDown(code) {
    return this._keysDown.has(code);
  }

  /**
   * 读取当前帧的标准化输入状态
   * @returns {InputState}
   */
  getState() {
    const rawPitch =
      (this._isDown(InputConfig.KEY_PITCH_UP) ? 1 : 0) -
      (this._isDown(InputConfig.KEY_PITCH_DOWN) ? 1 : 0);
    const pitch = this._invertPitch ? -rawPitch : rawPitch;
    const yaw =
      (this._isDown(InputConfig.KEY_YAW_RIGHT) ? 1 : 0) -
      (this._isDown(InputConfig.KEY_YAW_LEFT) ? 1 : 0);
    const roll =
      (this._isDown(InputConfig.KEY_ROLL_RIGHT) ? 1 : 0) -
      (this._isDown(InputConfig.KEY_ROLL_LEFT) ? 1 : 0);
    const throttleDelta =
      (this._isDown(InputConfig.KEY_THROTTLE_UP) ? 1 : 0) -
      (this._isDown(InputConfig.KEY_THROTTLE_DOWN) ? 1 : 0);

    const landJustPressed =
      this._isDown(InputConfig.KEY_LAND_TOGGLE) &&
      !this._prevKeysDown.has(InputConfig.KEY_LAND_TOGGLE);
    const mineJustPressed =
      this._isDown(InputConfig.KEY_MINE) && !this._prevKeysDown.has(InputConfig.KEY_MINE);
    const dockJustPressed =
      this._isDown(InputConfig.KEY_DOCK_TOGGLE) &&
      !this._prevKeysDown.has(InputConfig.KEY_DOCK_TOGGLE);

    const state = {
      pitch,
      yaw,
      roll,
      boost: this._isDown(InputConfig.KEY_BOOST),
      brake: this._isDown(InputConfig.KEY_BRAKE),
      throttleDelta,
      triggers: {
        primary: this._mouseDown.has(InputConfig.MOUSE_BUTTON_PRIMARY_FIRE),
        secondary: this._isDown(InputConfig.KEY_SECONDARY_FIRE),
      },
      landJustPressed,
      mineJustPressed,
      dockJustPressed,
    };

    // 记录本帧按键快照，供下一次 getState() 调用计算边沿触发
    this._prevKeysDown = new Set(this._keysDown);

    return state;
  }

  /** 释放事件监听，场景销毁时调用，避免内存泄漏 */
  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('contextmenu', this._onContextMenu);
  }
}
