/**
 * Engine.js
 * ------------------------------------------------------------------
 * 功能：整个游戏的启动入口与生命周期管理者。负责创建 RendererManager、
 *       SceneManager、主摄像机、GameLoop，并统一处理窗口 resize 与
 *       页面可见性变化（切后台自动暂停，避免 dt 累积异常）。main.js
 *       只需要 new Engine(canvas)，其余一切系统装配都在这里完成，
 *       未来新增系统（物理世界/存档管理器）也应在此处注册，而不是散落
 *       在 main.js 中。
 * 输入：canvas: HTMLCanvasElement
 * 输出：
 *   - this.sceneManager  供外部挂载飞船/星场/未来的星球与敌人
 *   - this.camera        主摄像机，供 CameraRig 控制
 *   - this.eventBus       全局事件总线
 *   - start(updateFn)     启动主循环，updateFn(dt) 由调用方提供每帧业务逻辑
 * 调用关系：由 main.js 创建并驱动，是唯一的顶层组合根（Composition Root）
 * 复杂度：初始化 O(1)；resize O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { RenderConfig } from '../config/GameConfig.js';
import { RendererManager } from '../renderer/RendererManager.js';
import { SceneManager } from '../scene/SceneManager.js';
import { GameLoop } from './GameLoop.js';
import { EventBus } from '../core/EventBus.js';

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.eventBus = new EventBus();

    this.camera = new THREE.PerspectiveCamera(
      RenderConfig.CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      RenderConfig.CAMERA_NEAR,
      RenderConfig.CAMERA_FAR
    );
    this.camera.position.set(0, 4, -12);

    this.rendererManager = new RendererManager(canvas);
    this.sceneManager = new SceneManager();

    this._externalUpdate = null;
    this.loop = new GameLoop(
      (dt) => this._tickUpdate(dt),
      () => this._tickRender()
    );

    this._bindWindowEvents();
  }

  _bindWindowEvents() {
    window.addEventListener('resize', () => {
      this.rendererManager.resize(window.innerWidth, window.innerHeight, this.camera);
    });

    // 切换到后台标签页时暂停循环，避免恢复时出现巨大 dt 或后台耗费算力
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.loop.stop();
      } else {
        this.loop.start();
      }
    });
  }

  _tickUpdate(dt) {
    this.sceneManager.update(dt);
    if (this._externalUpdate) this._externalUpdate(dt);
  }

  _tickRender() {
    this.rendererManager.render(this.sceneManager.scene, this.camera);
  }

  /**
   * 启动引擎主循环
   * @param {(dt:number)=>void} [externalUpdateFn] main.js 提供的每帧业务逻辑
   *        （例如：读取输入 -> 更新飞船 -> 更新摄像机）。这样 Engine 本身
   *        不需要认识 PlayerShip / InputController 等具体业务类。
   */
  start(externalUpdateFn) {
    this._externalUpdate = externalUpdateFn || null;
    this.loop.start();
  }

  stop() {
    this.loop.stop();
  }
}
