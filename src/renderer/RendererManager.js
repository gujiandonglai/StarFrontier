/**
 * RendererManager.js
 * ------------------------------------------------------------------
 * 功能：封装 THREE.WebGLRenderer 的创建与配置（色调映射、像素比、尺寸），
 *       并统一处理窗口 resize。后续 Phase（Bloom / 后处理管线）将在此
 *       模块之上叠加 EffectComposer，而不改变外部调用方式，保证接口稳定。
 * 输入：canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera
 * 输出：暴露 renderer 实例与 render()/resize() 方法
 * 调用关系：被 engine/Engine.js 创建并持有一个实例
 * 复杂度：O(1) 初始化；render() 复杂度取决于场景内物体数量（由 Three.js 内部管理）
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { RenderConfig } from '../config/GameConfig.js';

export class RendererManager {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: RenderConfig.ANTIALIAS,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true, // 太空场景尺度跨度极大（飞船 vs 行星 vs 星系），避免 z-fighting
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, RenderConfig.MAX_PIXEL_RATIO)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    // 电影级色调映射，配合后续发光材质（引擎尾焰/护盾）呈现 HDR 质感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RenderConfig.TONE_MAPPING_EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 预留：Phase 3 起将在此处挂载 EffectComposer（Bloom/景深/畸变）
    this.composer = null;
  }

  /**
   * 执行一次渲染
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(scene, camera) {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  /**
   * 响应窗口尺寸变化
   * @param {number} width
   * @param {number} height
   * @param {THREE.PerspectiveCamera} camera
   */
  resize(width, height, camera) {
    this.renderer.setSize(width, height, false);
    if (camera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  dispose() {
    this.renderer.dispose();
  }

  /**
   * Phase7：图形质量设置调整像素比上限（数值越低，渲染分辨率越低、
   * 越省性能）。立即应用一次新的像素比，不需要等到下次 resize。
   * @param {number} cap
   */
  setPixelRatioCap(cap) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }
}
