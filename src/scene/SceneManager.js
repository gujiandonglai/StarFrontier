/**
 * SceneManager.js
 * ------------------------------------------------------------------
 * 功能：持有 THREE.Scene，负责基础光照搭建，并维护一份「可更新对象」
 *       注册表——任何拥有 update(dt) 方法的对象都可以注册进来，由
 *       SceneManager 统一驱动，从而让 Engine 不需要认识具体的业务类
 *       （飞船、敌人、星场……），实现关注点分离。
 * 输入：无（构造时自建 THREE.Scene）
 * 输出：
 *   - scene: THREE.Scene 实例，供渲染器使用
 *   - add(object3D, {updatable}) 添加物体，可选加入更新队列
 *   - remove(object3D)           移除物体并解除更新注册
 *   - update(dt)                 驱动所有已注册对象
 * 调用关系：被 engine/Engine.js 创建持有；被 main.js 用来挂载
 *           星场 / 飞船 / 未来的敌人与星球
 * 复杂度：update() 为 O(n)，n 为已注册的可更新对象数量
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();

    /** @type {Set<{update:(dt:number)=>void}>} */
    this._updatables = new Set();

    this._setupLighting();
  }

  /** 搭建基础光照：环境光 + 模拟远方恒星的方向光 */
  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x293241, 1.1);
    this.scene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0xfff2d9, 2.6);
    sunLight.position.set(600, 300, -400);
    sunLight.castShadow = false; // Phase1 暂不开启阴影，留待性能预算充足后在 Phase3+ 开启
    this.scene.add(sunLight);
    this.sunLight = sunLight;

    // 补一个冷色回光，避免飞船背光面死黑，模拟星云散射光
    const fillLight = new THREE.DirectionalLight(0x4a6fa5, 0.6);
    fillLight.position.set(-400, -200, 500);
    this.scene.add(fillLight);
  }

  /**
   * 向场景添加一个 Object3D
   * @param {THREE.Object3D} object3D
   * @param {{updatable?: {update:(dt:number)=>void}}} [options]
   */
  add(object3D, options = {}) {
    this.scene.add(object3D);
    if (options.updatable) {
      this._updatables.add(options.updatable);
    }
  }

  /**
   * 从场景移除一个 Object3D
   * @param {THREE.Object3D} object3D
   * @param {{updatable?: {update:(dt:number)=>void}}} [options]
   */
  remove(object3D, options = {}) {
    this.scene.remove(object3D);
    if (options.updatable) {
      this._updatables.delete(options.updatable);
    }
  }

  /** 每帧调用一次，驱动所有已注册的可更新对象 */
  update(dt) {
    for (const entity of this._updatables) {
      entity.update(dt);
    }
  }
}
