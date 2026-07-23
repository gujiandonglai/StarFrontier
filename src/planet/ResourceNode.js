/**
 * ResourceNode.js
 * ------------------------------------------------------------------
 * 功能：行星表面的可采集资源节点。持有位置、资源类型、可获得数量，
 *       以及一个缓慢自转的水晶造型 Mesh（提示"这是可交互物体"）。玩家
 *       靠近并按下采集键时，由 planet/LandingController.js 调用 mine()，
 *       一次性采满——Phase3 简化为「一次性拾取」而非「持续钻探动画/
 *       进度条」，真正的采矿小游戏属于后续 UI 打磨范畴，不影响资源
 *       系统本身的数据流转（这条数据流会在 Phase4 经济系统中被复用：
 *       采到的资源直接进 CargoHold，交易系统只需要读 CargoHold）。
 * 输入：构造 { position, resourceType, amount }；mine()
 * 输出：mine() 返回 {resourceId, amount} 或 null（已采空时）
 * 调用关系：由 planet/PlanetSurfaceGenerator.js 批量创建；
 *           被 planet/LandingController.js 驱动 update() 与 mine()
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

export class ResourceNode {
  /**
   * @param {object} config
   * @param {THREE.Vector3} config.position 表面局部坐标（相对地表 group 原点）
   * @param {{id:string, name:string, color:number}} config.resourceType
   * @param {number} config.amount
   */
  constructor({ position, resourceType, amount }) {
    this.resourceType = resourceType;
    this.amount = amount;
    this.depleted = false;

    const geometry = new THREE.OctahedronGeometry(1.6, 0);
    const material = new THREE.MeshStandardMaterial({
      color: resourceType.color,
      emissive: resourceType.color,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.3,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
  }

  /** 缓慢自转，纯视觉提示 */
  update(dt) {
    if (this.depleted) return;
    this.mesh.rotation.y += dt * 0.6;
  }

  /**
   * 一次性采集
   * @returns {{resourceId:string, amount:number}|null}
   */
  mine() {
    if (this.depleted) return null;
    this.depleted = true;
    this.mesh.visible = false;
    return { resourceId: this.resourceType.id, amount: this.amount };
  }
}
