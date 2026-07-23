/**
 * MissionManager.js
 * ------------------------------------------------------------------
 * 功能：任务的生成、接取、进度追踪与结算。每个阵营的任务板首次被查看
 *       时生成 3 个随机任务实例并缓存（同一阵营在同一次会话里任务列表
 *       是稳定的，除非被接取/完成后重新生成）。玩家一次只能激活一个
 *       任务——Phase5 的刻意简化：并行任务队列对当前架构没有实质困难，
 *       但会把 UI 复杂度抬高一截，先把「任务 -> 事件驱动进度 -> 结算 ->
 *       声望联动」这条链路做扎实更重要。
 *       进度追踪完全通过监听早已存在的事件完成（combat:destroyed /
 *       resource:mined / economy:sold / planet:landed），不需要在战斗/
 *       采矿/交易/降落任何一处业务逻辑里插入"任务感知"代码——任务系统
 *       是纯粹的旁观者，这正是 Phase1 就开始铺垫的 EventBus 解耦设计的
 *       价值：新系统可以在不改动旧系统一行代码的前提下接入。
 * 输入：
 *   - 构造：{ eventBus, reputationSystem, playerShip }
 *   - getOffersForFaction(factionId)
 *   - acceptMission(mission) / abandonActiveMission()
 * 输出：this.activeMission；'mission:accepted'/'mission:progress'/
 *       'mission:completed'/'mission:abandoned' 事件
 * 调用关系：由 main.js 创建单例；任务板 UI 读取 getOffersForFaction()
 *          与 this.activeMission
 * 复杂度：事件回调 O(1)；getOffersForFaction 首次 O(模板数)，之后 O(1)
 * ------------------------------------------------------------------
 */
import { MISSION_TEMPLATES, MissionType } from './MissionDefs.js';
import { RESOURCE_TYPES } from '../economy/ResourceDefs.js';
import { getFactionDef, FACTION_IDS } from '../faction/FactionDefs.js';
import { CollisionGroup } from '../physics/CollisionGroups.js';

const OFFERS_PER_FACTION = 3;
// 消灭敌对单位（目前唯一的敌人archetype，设定上就是海盗）对三大正规
// 阵营都有一点被动声望增益，不需要任务在身——"打海盗总归是好事"
const PASSIVE_BOUNTY_REPUTATION = 1;
const PASSIVE_BOUNTY_FACTIONS = [FACTION_IDS.FEDERATION, FACTION_IDS.EMPIRE, FACTION_IDS.COMMERCE];

let _nextMissionInstanceId = 1;

export class MissionManager {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   * @param {import('../faction/ReputationSystem.js').ReputationSystem} deps.reputationSystem
   * @param {import('../ship/PlayerShip.js').PlayerShip} deps.playerShip
   */
  constructor({ eventBus, reputationSystem, playerShip }) {
    this.eventBus = eventBus;
    this.reputationSystem = reputationSystem;
    this.playerShip = playerShip;

    /** @type {Map<string, object[]>} factionId -> 该阵营当前可接的任务实例列表 */
    this._offersByFaction = new Map();
    /** @type {object|null} */
    this.activeMission = null;
    /** 探索任务用：记录本次任务已经降落过的行星类型（近似"不同行星"的判定） */
    this._landedPlanetTypesThisMission = new Set();

    eventBus.on('combat:destroyed', (payload) => this._onCombatDestroyed(payload));
    eventBus.on('resource:mined', (payload) => this._onResourceMined(payload));
    eventBus.on('economy:sold', (payload) => this._onResourceSold(payload));
    eventBus.on('planet:landed', (payload) => this._onPlanetLanded(payload));
  }

  /**
   * @param {string} factionId
   * @returns {object[]}
   */
  getOffersForFaction(factionId) {
    const existing = this._offersByFaction.get(factionId);
    // 没生成过，或者已经被接完了 —— 两种情况都需要补一批新的，
    // 否则玩家接完所有任务后这个阵营就永远"暂无任务"了
    if (!existing || existing.length === 0) {
      this._offersByFaction.set(factionId, this._generateOffers(factionId));
    }
    return this._offersByFaction.get(factionId);
  }

  _generateOffers(factionId) {
    const faction = getFactionDef(factionId);
    const pool = [...MISSION_TEMPLATES];
    const offers = [];
    const count = Math.min(OFFERS_PER_FACTION, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const template = pool.splice(idx, 1)[0];
      offers.push(this._instantiate(template, faction));
    }
    return offers;
  }

  _instantiate(template, faction) {
    const [minCount, maxCount] = template.targetCountRange;
    const targetCount = Math.round(minCount + Math.random() * (maxCount - minCount));

    const needsResource = template.type === MissionType.MINING || template.type === MissionType.TRADE;
    const resourceDef = needsResource
      ? RESOURCE_TYPES[Math.floor(Math.random() * RESOURCE_TYPES.length)]
      : null;

    const description = template.descriptionTemplate({
      targetCount,
      resourceName: resourceDef?.name ?? '',
      factionName: faction.name,
    });

    return {
      instanceId: `mission_${_nextMissionInstanceId++}`,
      templateId: template.id,
      type: template.type,
      factionId: faction.id,
      title: template.titleTemplate,
      description,
      targetCount,
      progress: 0,
      resourceId: resourceDef?.id ?? null,
      rewardCredits: Math.round(targetCount * template.rewardCreditsPerUnit),
      rewardReputation: template.rewardReputation,
      completed: false,
    };
  }

  /**
   * @param {object} mission 必须是 getOffersForFaction() 当前返回列表里的一项
   * @returns {boolean} 是否接取成功
   */
  acceptMission(mission) {
    if (this.activeMission) return false;

    this.activeMission = mission;
    const offers = this._offersByFaction.get(mission.factionId);
    if (offers) {
      const idx = offers.indexOf(mission);
      if (idx !== -1) offers.splice(idx, 1);
    }
    this._landedPlanetTypesThisMission.clear();

    this.eventBus.emit('mission:accepted', { mission });
    return true;
  }

  abandonActiveMission() {
    if (!this.activeMission) return;
    const mission = this.activeMission;
    this.activeMission = null;
    this.eventBus.emit('mission:abandoned', { mission });
  }

  _completeActiveMission() {
    const mission = this.activeMission;
    mission.completed = true;
    this.playerShip.wallet.addCredits(mission.rewardCredits);
    this.reputationSystem.adjust(mission.factionId, mission.rewardReputation);
    this.activeMission = null;
    this.eventBus.emit('mission:completed', { mission });
  }

  /**
   * @param {string} type MissionType 枚举之一
   * @param {number} amount 本次推进量
   * @param {boolean} matchesResource 若任务绑定了具体资源，是否与本次事件的资源一致
   */
  _progressActiveMission(type, amount, matchesResource) {
    const m = this.activeMission;
    if (!m || m.type !== type) return;
    if (m.resourceId && !matchesResource) return;

    m.progress = Math.min(m.targetCount, m.progress + amount);
    this.eventBus.emit('mission:progress', { mission: m });
    if (m.progress >= m.targetCount) this._completeActiveMission();
  }

  _onCombatDestroyed(payload) {
    if (payload.ownerTag !== 'enemy') return;
    if (payload.sourceTag !== CollisionGroup.PLAYER_PROJECTILE) return; // 只认玩家自己的战果

    for (const factionId of PASSIVE_BOUNTY_FACTIONS) {
      this.reputationSystem.adjust(factionId, PASSIVE_BOUNTY_REPUTATION);
    }
    this._progressActiveMission(MissionType.BOUNTY, 1, true);
  }

  _onResourceMined({ resourceId, accepted }) {
    const matches = this.activeMission?.resourceId === resourceId;
    this._progressActiveMission(MissionType.MINING, accepted, matches);
  }

  _onResourceSold({ resourceId, amount }) {
    const matches = this.activeMission?.resourceId === resourceId;
    this._progressActiveMission(MissionType.TRADE, amount, matches);
  }

  _onPlanetLanded({ type }) {
    if (!this.activeMission || this.activeMission.type !== MissionType.EXPLORATION) return;
    if (this._landedPlanetTypesThisMission.has(type)) return; // 同类型不重复计数
    this._landedPlanetTypesThisMission.add(type);
    this._progressActiveMission(MissionType.EXPLORATION, 1, true);
  }
}
