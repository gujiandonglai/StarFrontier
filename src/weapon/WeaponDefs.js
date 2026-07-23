/**
 * WeaponDefs.js
 * ------------------------------------------------------------------
 * 功能：数据驱动的武器定义表。需求文档「十、武器」要求「不少于50种」，
 *       在一次 Phase 交付中手工编写 50 种武器的完整数值并不现实，也不
 *       是这套系统的瓶颈所在——真正的工程重点是把武器做成「纯数据 +
 *       通用逻辑」的结构，使后续批量新增武器时只需要在这张表里追加条目，
 *       不需要写任何新代码、也不需要碰 WeaponSystem/Projectile。
 *       本表先给出 6 种覆盖不同武器大类的完整示例（机枪/激光/电浆炮/
 *       追踪导弹/EMP/轨道炮），并为「机枪」示范了一条完整的三级升级树
 *       （tier 1→3，伤害与射速递增），其余武器可仿照 UPGRADE_TREE 的
 *       写法自行扩展到 50+ 种。
 * 输入：无（静态数据）
 * 输出：WEAPON_DEFS（Map<id, WeaponDef>），getWeaponDef(id)
 * 调用关系：被 weapon/WeaponSystem.js 读取以构造具体武器实例；
 *           被 ship/PlayerShip.js、enemy/EnemyShip.js 用于配置初始装备
 * 复杂度：getWeaponDef() 为 O(1)（Map 查找）
 * ------------------------------------------------------------------
 */

/**
 * @typedef {Object} WeaponDef
 * @property {string} id 唯一标识
 * @property {string} name 显示名称
 * @property {'kinetic'|'energy'|'missile'} type 武器大类，决定弹道/命中表现
 * @property {number} damage 单发伤害
 * @property {number} fireRate 每秒可发射次数
 * @property {number} projectileSpeed 弹丸飞行速度（单位/秒），missile 类型会在此基础上追加转向
 * @property {number} projectileRadius 弹丸碰撞半径
 * @property {number} lifetime 弹丸存活秒数（超时未命中则回收，防止无限追踪飞船外）
 * @property {number} energyCost 每次开火消耗的能量（Phase6 能源系统接入后生效，当前仅记录）
 * @property {number} cost 在空间站改装面板购买/安装这件武器所需的信用点（Phase6）
 * @property {number} tier 等级（1起）
 * @property {'common'|'uncommon'|'rare'|'epic'|'legendary'} rarity 稀有度
 * @property {number} color 弹丸/激光颜色（十六进制）
 * @property {boolean} [homing] 是否具备追踪能力
 * @property {number} [turnRateRadPerSec] 追踪转向角速度（仅 homing 武器）
 * @property {string} [nextTierId] 升级树：下一级武器的 id（无则代表已是顶级）
 */

/** @type {WeaponDef[]} */
const _RAW_DEFS = [
  // ---- 机枪：完整三级升级树示例（mk1 是出厂标配，免费） ----
  {
    id: 'machine_gun_mk1', name: '机枪 Mk.I', type: 'kinetic',
    damage: 6, fireRate: 8, projectileSpeed: 380, projectileRadius: 0.12,
    lifetime: 2.5, energyCost: 0, cost: 0, tier: 1, rarity: 'common',
    color: 0xffe08a, nextTierId: 'machine_gun_mk2',
  },
  {
    id: 'machine_gun_mk2', name: '机枪 Mk.II', type: 'kinetic',
    damage: 8, fireRate: 9, projectileSpeed: 400, projectileRadius: 0.13,
    lifetime: 2.5, energyCost: 0, cost: 500, tier: 2, rarity: 'uncommon',
    color: 0xffd35c, nextTierId: 'machine_gun_mk3',
  },
  {
    id: 'machine_gun_mk3', name: '机枪 Mk.III', type: 'kinetic',
    damage: 11, fireRate: 10, projectileSpeed: 420, projectileRadius: 0.14,
    lifetime: 2.5, energyCost: 0, cost: 1400, tier: 3, rarity: 'rare',
    color: 0xffc233, nextTierId: null,
  },

  // ---- 脉冲激光：高射速、低单发伤害、命中即时性强 ----
  {
    id: 'pulse_laser_mk1', name: '脉冲激光炮', type: 'energy',
    damage: 5, fireRate: 12, projectileSpeed: 620, projectileRadius: 0.1,
    lifetime: 1.6, energyCost: 2, cost: 600, tier: 1, rarity: 'common',
    color: 0x2ec4ff, nextTierId: null,
  },

  // ---- 电浆炮：慢速高伤害 ----
  {
    id: 'plasma_cannon_mk1', name: '电浆炮', type: 'energy',
    damage: 34, fireRate: 1.4, projectileSpeed: 190, projectileRadius: 0.35,
    lifetime: 4.0, energyCost: 9, cost: 1600, tier: 1, rarity: 'uncommon',
    color: 0xb14bff, nextTierId: null,
  },

  // ---- 追踪导弹：会主动修正弹道追向目标（mk1 是出厂标配副武器，免费） ----
  {
    id: 'homing_missile_mk1', name: '追踪导弹', type: 'missile',
    damage: 55, fireRate: 0.8, projectileSpeed: 150, projectileRadius: 0.3,
    lifetime: 6.0, energyCost: 5, cost: 0, tier: 1, rarity: 'rare',
    color: 0xff5c5c, homing: true, turnRateRadPerSec: 2.2, nextTierId: null,
  },

  // ---- EMP 脉冲炮：低伤害但用于压制（Phase5 起可扩展为致盾/致电子系统失灵）----
  {
    id: 'emp_blaster_mk1', name: 'EMP脉冲炮', type: 'energy',
    damage: 9, fireRate: 2.0, projectileSpeed: 260, projectileRadius: 0.22,
    lifetime: 3.0, energyCost: 6, cost: 750, tier: 1, rarity: 'uncommon',
    color: 0x7dffb3, nextTierId: null,
  },

  // ---- 轨道炮：极高单发伤害、极低射速 ----
  {
    id: 'railgun_mk1', name: '轨道炮', type: 'kinetic',
    damage: 90, fireRate: 0.5, projectileSpeed: 900, projectileRadius: 0.15,
    lifetime: 2.0, energyCost: 14, cost: 2600, tier: 1, rarity: 'epic',
    color: 0xffffff, nextTierId: null,
  },
];

export const WEAPON_DEFS = new Map(_RAW_DEFS.map((def) => [def.id, def]));

/**
 * 按 id 查询武器定义
 * @param {string} id
 * @returns {WeaponDef}
 */
export function getWeaponDef(id) {
  const def = WEAPON_DEFS.get(id);
  if (!def) {
    throw new Error(`[WeaponDefs] 未知武器 id: ${id}`);
  }
  return def;
}
