/**
 * ObjectPool.js
 * ------------------------------------------------------------------
 * 功能：通用对象池。武器系统每秒可能创建/销毁上百个 Projectile，
 *       特效系统每次爆炸创建几十个粒子，若每次都 new 一个新对象，
 *       会触发频繁 GC 造成掉帧（对应需求文档「二十三、性能」中的
 *       「对象池」条目）。本池子采用「预分配 + 借还」模式：
 *       acquire() 优先复用已归还的对象，用尽才调用 factory 创建新对象；
 *       release() 调用 resetFn 清理状态后放回池中。
 * 输入：
 *   - factory: () => T                创建新对象的工厂函数
 *   - resetFn: (obj: T) => void       归还时重置对象状态的函数
 *   - initialSize?: number            预热数量
 * 输出：acquire(): T，release(obj: T): void，size 相关统计
 * 调用关系：被 weapon/WeaponSystem.js（Projectile 池）与
 *           particle/ParticleSystem.js（粒子池）使用
 * 复杂度：acquire()/release() 均为均摊 O(1)
 * ------------------------------------------------------------------
 */
export class ObjectPool {
  /**
   * @param {() => any} factory
   * @param {(obj:any) => void} resetFn
   * @param {number} [initialSize]
   */
  constructor(factory, resetFn, initialSize = 0) {
    this._factory = factory;
    this._resetFn = resetFn;
    /** @type {any[]} */
    this._free = [];
    this._activeCount = 0;

    for (let i = 0; i < initialSize; i++) {
      this._free.push(this._factory());
    }
  }

  /** 从池中取出一个对象（若池为空则新建） */
  acquire() {
    const obj = this._free.length > 0 ? this._free.pop() : this._factory();
    this._activeCount++;
    return obj;
  }

  /** 归还对象给池子，重置状态以便下次复用 */
  release(obj) {
    this._resetFn(obj);
    this._free.push(obj);
    this._activeCount = Math.max(0, this._activeCount - 1);
  }

  get activeCount() {
    return this._activeCount;
  }

  get pooledCount() {
    return this._free.length;
  }
}
