/**
 * FactionDefs.js
 * ------------------------------------------------------------------
 * 功能：四大阵营（宇宙联邦/银河帝国/行星商业同盟/海盗联盟）的静态元数据，
 *       以及「扇区领地标签 -> 阵营 id」的映射——Phase3 的 GalaxyGenerator
 *       早就在生成每个扇区的 territory 字段（联邦区域/帝国区域/商盟
 *       区域/海盗区/无主星域，纯展示用），Phase5 只是第一次真正读取
 *       它来决定「这个空间站归属哪个阵营、任务板上该出现谁的任务」，
 *       不需要改动 GalaxyGenerator 本身。
 *       AI文明与古代文明遗迹（需求文档「七、阵营」提到的隐藏势力）
 *       仍未实现——它们被设计为"后期解锁"的隐藏内容，本来就不该在
 *       Phase5 就摊开，留给更后期的阶段。
 * 输入：无（静态数据）
 * 输出：FACTION_IDS、FACTION_DEFS、TERRITORY_TO_FACTION、getFactionDef(id)
 * 调用关系：被 faction/ReputationSystem.js、faction/TechTreeSystem.js、
 *           mission/MissionManager.js、main.js（任务板/阵营信息 UI）引用
 * 复杂度：O(1)
 * ------------------------------------------------------------------
 */

export const FACTION_IDS = Object.freeze({
  FEDERATION: 'federation',
  EMPIRE: 'empire',
  COMMERCE: 'commerce',
  PIRATES: 'pirates',
});

/**
 * @typedef {Object} FactionDef
 * @property {string} id
 * @property {string} name
 * @property {number} color 用于 UI 强调色/阵营标签着色
 * @property {string} description
 */

export const FACTION_DEFS = Object.freeze({
  [FACTION_IDS.FEDERATION]: {
    id: FACTION_IDS.FEDERATION,
    name: '宇宙联邦',
    color: 0x2ec4ff,
    description: '崇尚科技与高机动作战的星际联邦，重视探索与外交。',
  },
  [FACTION_IDS.EMPIRE]: {
    id: FACTION_IDS.EMPIRE,
    name: '银河帝国',
    color: 0xff5d47,
    description: '军国主义色彩浓厚的重装甲舰队，信奉正面火力压制。',
  },
  [FACTION_IDS.COMMERCE]: {
    id: FACTION_IDS.COMMERCE,
    name: '行星商业同盟',
    color: 0xffb84d,
    description: '掌控银河贸易命脉的商人联合体，武器研发与物流并重。',
  },
  [FACTION_IDS.PIRATES]: {
    id: FACTION_IDS.PIRATES,
    name: '海盗联盟',
    color: 0x9a5cff,
    description: '游离于三大阵营秩序之外的劫掠者，没有正式领土。',
  },
});

/** 扇区领地标签（GalaxyConfig.TERRITORIES）到阵营 id 的映射 */
export const TERRITORY_TO_FACTION = Object.freeze({
  联邦区域: FACTION_IDS.FEDERATION,
  帝国区域: FACTION_IDS.EMPIRE,
  商盟区域: FACTION_IDS.COMMERCE,
  海盗区: FACTION_IDS.PIRATES,
  无主星域: null, // 无主之地，没有实际统治者，站点不发放阵营任务
});

/**
 * @param {string} id
 * @returns {FactionDef}
 */
export function getFactionDef(id) {
  const def = FACTION_DEFS[id];
  if (!def) throw new Error(`[FactionDefs] 未知阵营 ID: ${id}`);
  return def;
}
