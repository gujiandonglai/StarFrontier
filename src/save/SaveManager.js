/**
 * SaveManager.js
 * ------------------------------------------------------------------
 * 功能：游戏存档的 IndexedDB 读写层（需求文档「二十、存档」明确要求
 *       "必须使用 IndexedDB"）。支持多个具名存档槽位 + 一个专用的
 *       autosave 槽位，每条记录都带 schemaVersion 字段——如果未来存档
 *       结构发生不兼容变化，可以在 save/SaveSerializer.js 里按
 *       schemaVersion 做迁移，而不用把旧存档全部作废。
 *       本文件只负责"把一个已经序列化好的普通对象存进/取出 IndexedDB"，
 *       不关心这个对象里具体装的是什么——那是 SaveSerializer.js 的职责，
 *       两者职责分离：SaveManager 只懂"存储"，不懂"游戏状态"。
 * 输入：
 *   - open()：必须先调用并 await 一次，之后才能读写
 *   - writeSlot(slotId, payload)
 *   - readSlot(slotId)
 *   - listSlots()
 *   - deleteSlot(slotId)
 * 输出：Promise，resolve 为对应的数据/数组/undefined
 * 调用关系：由 main.js 创建单例；save/SaveSerializer.js 产出的 payload
 *          通过这里写入/读出
 * 复杂度：所有操作均为 O(1)（IndexedDB 内部按 key 索引）
 * ------------------------------------------------------------------
 */

const DB_NAME = 'starfrontier-saves';
const DB_VERSION = 1;
const STORE_NAME = 'saves';
export const SCHEMA_VERSION = 1; // SaveSerializer 产出的存档数据结构版本号
export const AUTOSAVE_SLOT_ID = '__autosave__';

export class SaveManager {
  constructor() {
    /** @type {IDBDatabase|null} */
    this._db = null;
  }

  /** 打开（并在需要时升级）数据库，必须在读写前调用一次并 await */
  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // keyPath 用 slotId，天然保证同一槽位再次写入是"覆盖"而不是新增
          db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  _requireDb() {
    if (!this._db) {
      throw new Error('[SaveManager] 尚未调用 open()，不能读写存档');
    }
    return this._db;
  }

  /**
   * 写入（或覆盖）一个存档槽位
   * @param {string} slotId
   * @param {object} payload 已经由 SaveSerializer.serialize() 产出的普通对象
   * @returns {Promise<void>}
   */
  writeSlot(slotId, payload) {
    const db = this._requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = { slotId, ...payload };
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 读取一个存档槽位
   * @param {string} slotId
   * @returns {Promise<object|undefined>}
   */
  readSlot(slotId) {
    const db = this._requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(slotId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 列出所有存档槽位（供"读取存档"界面展示摘要信息用）
   * @returns {Promise<object[]>}
   */
  listSlots() {
    const db = this._requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @param {string} slotId
   * @returns {Promise<void>}
   */
  deleteSlot(slotId) {
    const db = this._requireDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(slotId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
