/**
 * GalacticWarSimulator.js
 * ------------------------------------------------------------------
 * 功能：需求文档「八、动态银河」与「十、动态战争」要求的核心——银河不是
 *       静止的，阵营会互相攻伐，玩家的行动真的会改变银河局势。
 *       完整模拟每个阵营的舰队在整个（理论上无限的）银河里打仗是不现实
 *       的，这里退而求其次做一个仍然"真实"的简化：
 *         1. 每个阵营有一个"实力"数值（factionPower），玩家消灭海盗、
 *            完成任务都会推高相关阵营的实力（海盗的实力则会因为被玩家
 *            剿灭而下降）——这是玩家行动影响战局的具体机制，不是装饰。
 *         2. 只跟踪玩家实际到访过的扇区（registerSector 由
 *            galaxy/GalaxyStreamer.js 在扇区加载时调用）——银河大概率是
 *            无限的，为从未去过的扇区维护战争状态没有意义，玩家也永远
 *            不会知道。
 *         3. 每隔一段时间（WAR_TICK_INTERVAL），对每个被跟踪的扇区，
 *            按"当前控制阵营 vs 随机挑战阵营"的实力对比滚一次易主判定。
 *            易主概率故意压得很低（单次判定 ≤15%），银河局势应该是
 *            "过一阵子回头看，发现变了"的量级，不是"每次进同一个扇区
 *            都不一样"的量级，后者只会显得随机而不是"真的在打仗"。
 *       这不是在假装做一个战争经济/舰队调度模拟器——它就是一个用实力
 *       数值驱动的概率状态机，但概率背后的数值是玩家真实行动喂出来的，
 *       这条因果链是真的，不是摆设。
 * 输入：
 *   - 构造：{ eventBus }
 *   - registerSector(sectorKey, originalFactionId)
 *   - getControllingFaction(sectorKey, originalFactionId)
 *   - update(dt)
 * 输出：this.factionPower：Map<factionId, number>；
 *       'war:territoryChanged' 事件 { sectorKey, from, to }
 * 调用关系：由 main.js 创建单例并传给 galaxy/GalaxyStreamer.js；
 *          监听 combat:destroyed / mission:completed 事件驱动实力变化
 * 复杂度：update() 为 O(已跟踪扇区数)，玩家实际到访过的扇区数量级
 *         （几十到几百），不是整个银河
 * ------------------------------------------------------------------
 */
import { FACTION_IDS } from './FactionDefs.js';
import { CollisionGroup } from '../physics/CollisionGroups.js';

const WAR_TICK_INTERVAL = 25; // 秒，每隔这么久对所有被跟踪扇区滚一次易主判定
const TAKEOVER_CHANCE_SCALE = 0.15; // 单次判定的概率上限（挑战方实力占绝对优势时）
const LAWFUL_FACTIONS = [FACTION_IDS.FEDERATION, FACTION_IDS.EMPIRE, FACTION_IDS.COMMERCE];
const ALL_FACTIONS = [...LAWFUL_FACTIONS, FACTION_IDS.PIRATES];

export class GalacticWarSimulator {
  /** @param {import('../core/EventBus.js').EventBus} eventBus */
  constructor(eventBus) {
    this.eventBus = eventBus;

    /** @type {Map<string, number>} */
    this.factionPower = new Map([
      [FACTION_IDS.FEDERATION, 50],
      [FACTION_IDS.EMPIRE, 50],
      [FACTION_IDS.COMMERCE, 50],
      [FACTION_IDS.PIRATES, 35],
    ]);

    /** @type {Map<string, string|null>} 只记录"和程序生成结果不同"的扇区，节省内存 */
    this._territoryOverrides = new Map();
    /** @type {Map<string, string|null>} 被跟踪的扇区 -> 程序生成时的原始归属 */
    this._trackedSectors = new Map();

    this._tickTimer = WAR_TICK_INTERVAL;

    eventBus.on('combat:destroyed', (payload) => this._onCombatDestroyed(payload));
    eventBus.on('mission:completed', ({ mission }) => this._onMissionCompleted(mission));
  }

  _onCombatDestroyed(payload) {
    if (payload.ownerTag !== 'enemy') return;
    if (payload.sourceTag !== CollisionGroup.PLAYER_PROJECTILE) return; // 只认玩家自己的战果

    this._addPower(FACTION_IDS.PIRATES, -1.2);
    for (const factionId of LAWFUL_FACTIONS) {
      this._addPower(factionId, 0.3);
    }
  }

  _onMissionCompleted(mission) {
    this._addPower(mission.factionId, 4);
  }

  _addPower(factionId, delta) {
    const current = this.factionPower.get(factionId) ?? 0;
    this.factionPower.set(factionId, Math.max(0, current + delta));
  }

  /**
   * 登记一个扇区进入战争模拟的跟踪范围。只有第一次调用生效（幂等），
   * 由 GalaxyStreamer 在扇区加载时调用，不需要区分"是不是第一次去"。
   * @param {string} sectorKey
   * @param {string|null} originalFactionId 该扇区程序生成时的原始归属（无主星域为 null）
   */
  registerSector(sectorKey, originalFactionId) {
    if (!this._trackedSectors.has(sectorKey)) {
      this._trackedSectors.set(sectorKey, originalFactionId);
    }
  }

  /**
   * 查询某扇区当前的实际控制阵营——如果曾经易主过，返回易主后的结果，
   * 否则返回程序生成时的原始归属
   * @param {string} sectorKey
   * @param {string|null} originalFactionId
   * @returns {string|null}
   */
  getControllingFaction(sectorKey, originalFactionId) {
    return this._territoryOverrides.has(sectorKey)
      ? this._territoryOverrides.get(sectorKey)
      : originalFactionId;
  }

  /** @param {number} dt 秒 */
  update(dt) {
    this._tickTimer -= dt;
    if (this._tickTimer > 0) return;
    this._tickTimer = WAR_TICK_INTERVAL;
    this._simulateTick();
  }

  _simulateTick() {
    for (const [sectorKey, originalFactionId] of this._trackedSectors) {
      const currentController = this.getControllingFaction(sectorKey, originalFactionId);
      if (!currentController) continue; // 无主星域没有"归属"，不参与易主模拟

      const challengerPool = ALL_FACTIONS.filter((f) => f !== currentController);
      const challenger = challengerPool[Math.floor(Math.random() * challengerPool.length)];

      const currentPower = this.factionPower.get(currentController) || 1;
      const challengerPower = this.factionPower.get(challenger) || 1;
      const takeoverChance =
        (challengerPower / (currentPower + challengerPower)) * TAKEOVER_CHANCE_SCALE;

      if (Math.random() < takeoverChance) {
        this._territoryOverrides.set(sectorKey, challenger);
        this.eventBus.emit('war:territoryChanged', {
          sectorKey,
          from: currentController,
          to: challenger,
        });
      }
    }
  }

  /**
   * 导出可存档的纯数据快照（供 save/SaveSerializer.js 使用）。不导出
   * _trackedSectors——它只是"哪些扇区值得跑模拟"的索引，读档后玩家飞到
   * 哪个扇区，galaxy/GalaxyStreamer.js 会在加载时重新登记，不需要存档。
   * @returns {{factionPower: Record<string, number>, territoryOverrides: Record<string, string>}}
   */
  getSerializableState() {
    const factionPower = {};
    for (const [factionId, power] of this.factionPower) factionPower[factionId] = power;

    const territoryOverrides = {};
    for (const [sectorKey, factionId] of this._territoryOverrides) {
      if (factionId) territoryOverrides[sectorKey] = factionId;
    }

    return { factionPower, territoryOverrides };
  }

  /**
   * 从存档数据恢复状态。必须在游戏世界组装完成后、任何扇区被 registerSector()
   * 之前调用——不过就算顺序反了也不会出错，只是恰好在读档那一刻已经被
   * 加载的扇区会在下一次 _simulateTick() 才用上恢复后的实力数值，
   * 不影响正确性，最多是那一帧的显示会稍微滞后。
   * @param {{factionPower?: Record<string, number>, territoryOverrides?: Record<string, string>}} state
   */
  restoreState(state) {
    if (!state) return;
    if (state.factionPower) {
      for (const [factionId, power] of Object.entries(state.factionPower)) {
        this.factionPower.set(factionId, power);
      }
    }
    if (state.territoryOverrides) {
      for (const [sectorKey, factionId] of Object.entries(state.territoryOverrides)) {
        this._territoryOverrides.set(sectorKey, factionId);
      }
    }
  }
}
