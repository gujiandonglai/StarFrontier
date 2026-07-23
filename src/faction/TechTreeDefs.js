/**
 * TechTreeDefs.js
 * ------------------------------------------------------------------
 * 功能：每个阵营的科技树节点数据（对应需求文档「六、阵营科技树」：
 *       联邦走速度线、帝国走装甲/护盾线、商盟走货运/后勤线）。Phase5
 *       只做数值加成，不做"装备安装/卸下"的概念——那是 Phase6 飞船
 *       模块化改装的范畴。每个节点的 effect 都指向 ship 组件上一个
 *       安全的、按实例持有的数值字段（ShipPhysics.maxSpeedMultiplier、
 *       Health.maxHull/maxShield/shieldRegenPerSecond、
 *       CargoHold.capacity——全部是构造时写入的实例属性，不是模块级
 *       共享配置，加到玩家身上不会误伤敌人/NPC，参见各自文件的注释）。
 * 输入：无（静态数据）
 * 输出：TECH_TREE_DEFS：{ [factionId]: TechNode[] }
 * 调用关系：被 faction/TechTreeSystem.js 引用
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */
import { FACTION_IDS } from './FactionDefs.js';
import { Standing } from './ReputationSystem.js';

/**
 * @typedef {Object} TechNode
 * @property {string} id
 * @property {string} name
 * @property {string} requiredStanding Standing 枚举之一
 * @property {{type:string, value:number}} effect
 * @property {string} description
 */

export const TECH_TREE_DEFS = Object.freeze({
  [FACTION_IDS.FEDERATION]: [
    {
      id: 'fed_engine_cert',
      name: '高速引擎认证',
      requiredStanding: Standing.FRIENDLY,
      effect: { type: 'speedMultiplierBonus', value: 0.08 },
      description: '联邦引擎技术授权，飞船最大速度 +8%。',
    },
    {
      id: 'fed_warp_nav',
      name: '空间折跃导航',
      requiredStanding: Standing.ALLIED,
      effect: { type: 'speedMultiplierBonus', value: 0.15 },
      description: '折跃导航系统进一步优化推进效率，最大速度额外 +15%。',
    },
  ],
  [FACTION_IDS.EMPIRE]: [
    {
      id: 'emp_armor_protocol',
      name: '装甲强化协议',
      requiredStanding: Standing.FRIENDLY,
      effect: { type: 'maxHullBonus', value: 20 },
      description: '帝国重装甲工艺授权，船体上限 +20。',
    },
    {
      id: 'emp_shield_license',
      name: '护盾强化许可',
      requiredStanding: Standing.ALLIED,
      effect: { type: 'maxShieldBonus', value: 15 },
      description: '帝国护盾技术许可，护盾上限 +15。',
    },
  ],
  [FACTION_IDS.COMMERCE]: [
    {
      id: 'com_cargo_permit',
      name: '货运许可',
      requiredStanding: Standing.FRIENDLY,
      effect: { type: 'cargoCapacityBonus', value: 30 },
      description: '商盟货运资质认证，货舱容量 +30。',
    },
    {
      id: 'com_auto_repair',
      name: '自动化维修协议',
      requiredStanding: Standing.ALLIED,
      effect: { type: 'shieldRegenBonus', value: 3 },
      description: '商盟自动化维修技术，护盾每秒回充速度 +3。',
    },
  ],
});
