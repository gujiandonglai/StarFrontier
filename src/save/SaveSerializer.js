/**
 * SaveSerializer.js
 * ------------------------------------------------------------------
 * 功能：把「活的」游戏对象（PlayerShip/ReputationSystem/TechTreeSystem/
 *       MissionManager/银河种子）转换成一个纯 JSON 安全的普通对象
 *       （serialize），或者反过来把读档数据应用回这些活对象上
 *       （deserialize）。
 *       关键设计决策：飞船的"派生数值"（maxHull/maxShield/maxEnergy/
 *       maxSpeedMultiplier 等）完全不存档——它们是"装了什么模块 + 声望
 *       解锁了什么科技"的确定性函数（见 ship/ShipLoadout.js 与
 *       faction/TechTreeSystem.js）。读档时只需要恢复"源头事实"
 *       （已安装的模块/武器 id、各阵营声望分值），然后重放
 *       ShipLoadout.install()/installWeapon() 与
 *       TechTreeSystem.checkUnlocks() 这两套正常游戏时就在用的加成
 *       应用逻辑，就能精确重建出完全一致的派生数值——不需要维护第二套
 *       "如何恢复数值"的逻辑，也不会出现"存档里的数字和实际生效的效果
 *       对不上"这类数据漂移问题。银河本身同理：只存一个种子，
 *       GalaxyGenerator 的确定性保证飞回同一扇区会看到同样的星系。
 *       "当前值"（hull/shield/energy/cargo/credits/位置朝向/击杀数/
 *       当前任务）才是真正需要存档的"事实"，直接原样存取。
 * 输入：serialize(state) / deserialize(data, state) / validate(data) / migrate(data)
 * 输出：serialize() 返回纯 JSON 安全对象；deserialize() 返回
 *       { killCount } 这类无法直接写回调用方闭包变量的"剩余标量"
 * 调用关系：被 main.js 在存档/读档时调用
 * 复杂度：O(货舱资源种类数)，可忽略不计
 * ------------------------------------------------------------------
 */
import { SCHEMA_VERSION } from './SaveManager.js';
import { getModuleDef } from '../ship/ModuleDefs.js';
import { getWeaponDef } from '../weapon/WeaponDefs.js';

const STAT_SLOTS = ['engine', 'armor', 'shield', 'reactor'];
const REPUTATION_FACTION_IDS = ['federation', 'empire', 'commerce', 'pirates'];

/**
 * 版本迁移表：未来 schemaVersion 从 1 升到 2 时，在这里加一条
 * `1: (oldData) => newData`。目前只发布过版本 1，没有任何迁移需要做，
 * 这里先把管线搭好，避免真正需要迁移的那一天要临时重构存档系统。
 */
const MIGRATIONS = {};

/**
 * @param {object} state
 * @param {import('../ship/PlayerShip.js').PlayerShip} state.playerShip
 * @param {number} state.galaxySeed
 * @param {import('../faction/ReputationSystem.js').ReputationSystem} state.reputationSystem
 * @param {import('../faction/GalacticWarSimulator.js').GalacticWarSimulator} state.warSimulator
 * @param {import('../mission/MissionManager.js').MissionManager} state.missionManager
 * @param {number} state.killCount
 * @returns {object}
 */
export function serialize(state) {
  const { playerShip, galaxySeed, reputationSystem, warSimulator, missionManager, killCount } = state;

  const cargoContents = {};
  for (const [resourceId, amount] of playerShip.cargoHold.contents) {
    cargoContents[resourceId] = amount;
  }

  const reputation = {};
  for (const factionId of REPUTATION_FACTION_IDS) {
    reputation[factionId] = reputationSystem.getScore(factionId);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: Date.now(),
    galaxySeed,
    player: {
      position: {
        x: playerShip.object3D.position.x,
        y: playerShip.object3D.position.y,
        z: playerShip.object3D.position.z,
      },
      quaternion: {
        x: playerShip.object3D.quaternion.x,
        y: playerShip.object3D.quaternion.y,
        z: playerShip.object3D.quaternion.z,
        w: playerShip.object3D.quaternion.w,
      },
      hull: playerShip.health.hull,
      shield: playerShip.health.shield,
      energy: playerShip.energyCore.current,
      cargo: cargoContents,
      credits: playerShip.wallet.credits,
      loadout: {
        engine: playerShip.loadout.installed.engine.id,
        armor: playerShip.loadout.installed.armor.id,
        shield: playerShip.loadout.installed.shield.id,
        reactor: playerShip.loadout.installed.reactor.id,
        primaryWeapon: playerShip.loadout.installedWeaponIds.primaryWeapon,
        secondaryWeapon: playerShip.loadout.installedWeaponIds.secondaryWeapon,
      },
    },
    reputation,
    war: warSimulator.getSerializableState(),
    activeMission: missionManager.activeMission,
    killCount,
  };
}

/**
 * @param {object} data 已经过 validate()/migrate() 处理的存档数据
 * @param {object} state 需要写回的活对象集合
 * @param {import('../ship/PlayerShip.js').PlayerShip} state.playerShip
 * @param {import('../faction/ReputationSystem.js').ReputationSystem} state.reputationSystem
 * @param {import('../faction/TechTreeSystem.js').TechTreeSystem} state.techTreeSystem
 * @param {import('../faction/GalacticWarSimulator.js').GalacticWarSimulator} state.warSimulator
 * @param {import('../mission/MissionManager.js').MissionManager} state.missionManager
 * @returns {{killCount:number}} 调用方需要手动赋回自己闭包里的 killCount 变量
 */
export function deserialize(data, state) {
  const { playerShip, reputationSystem, techTreeSystem, warSimulator, missionManager } = state;

  // ---- 位置/朝向：直接恢复，速度清零避免"读档瞬间带着上次的速度飞出去" ----
  const p = data.player.position;
  const q = data.player.quaternion;
  playerShip.object3D.position.set(p.x, p.y, p.z);
  playerShip.object3D.quaternion.set(q.x, q.y, q.z, q.w);
  playerShip.physics.velocity.set(0, 0, 0);
  playerShip.physics.angularVelocity.set(0, 0, 0);

  // ---- 声望：先静默设置分值，再统一重放科技树解锁 ----
  for (const factionId of REPUTATION_FACTION_IDS) {
    if (factionId in data.reputation) {
      reputationSystem.setScore(factionId, data.reputation[factionId]);
    }
  }
  techTreeSystem.checkUnlocks();

  // ---- Phase8：背景战争模拟状态（阵营实力 + 已易主的扇区） ----
  warSimulator.restoreState(data.war);

  // ---- 模块化改装：重放 install()/installWeapon()，正确叠加数值加成 ----
  const loadout = data.player.loadout || {};
  for (const slot of STAT_SLOTS) {
    const moduleId = loadout[slot];
    if (!moduleId) continue;
    try {
      playerShip.loadout.install(slot, getModuleDef(slot, moduleId));
    } catch (err) {
      console.warn(`[SaveSerializer] 恢复模块失败: ${slot}/${moduleId}`, err);
    }
  }
  if (loadout.primaryWeapon) {
    try {
      playerShip.loadout.installWeapon('primaryWeapon', getWeaponDef(loadout.primaryWeapon));
    } catch (err) {
      console.warn('[SaveSerializer] 恢复主武器失败', err);
    }
  }
  if (loadout.secondaryWeapon) {
    try {
      playerShip.loadout.installWeapon('secondaryWeapon', getWeaponDef(loadout.secondaryWeapon));
    } catch (err) {
      console.warn('[SaveSerializer] 恢复副武器失败', err);
    }
  }

  // ---- 当前值：必须在 loadout/科技树重放完成、maxHull 等上限已经正确
  //      之后再钳制，否则会被重放之前的默认上限错误截断 ----
  playerShip.health.hull = Math.min(data.player.hull, playerShip.health.maxHull);
  playerShip.health.shield = Math.min(data.player.shield, playerShip.health.maxShield);
  playerShip.health.isDestroyed = false;
  playerShip.energyCore.current = Math.min(data.player.energy, playerShip.energyCore.maxEnergy);

  // ---- 货舱 / 钱包 ----
  playerShip.cargoHold.contents.clear();
  for (const [resourceId, amount] of Object.entries(data.player.cargo || {})) {
    if (amount > 0) playerShip.cargoHold.contents.set(resourceId, amount);
  }
  playerShip.wallet.credits = data.player.credits;

  // ---- 任务：MissionManager.activeMission 是纯数据对象，直接整体替换即可 ----
  missionManager.activeMission = data.activeMission || null;

  return { killCount: data.killCount || 0 };
}

/**
 * 基本的存档数据校验（需求文档「二十、存档」要求的"数据校验"）。
 * 只检查结构完整性，不追求密码学级别的防篡改——单机游戏存档没有这个
 * 必要，浏览器 IndexedDB 也不是一个真正意义上的"不可信输入源"。
 * @param {object} data
 * @returns {{valid:boolean, reason?:string}}
 */
export function validate(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: '存档数据为空或格式错误' };
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    return {
      valid: false,
      reason: `存档版本（${data.schemaVersion}）比当前游戏版本（${SCHEMA_VERSION}）更新，无法读取`,
    };
  }
  if (!data.player || typeof data.player.hull !== 'number') {
    return { valid: false, reason: '存档缺少玩家飞船数据' };
  }
  if (typeof data.galaxySeed !== 'number') {
    return { valid: false, reason: '存档缺少银河种子' };
  }
  return { valid: true };
}

/**
 * 把旧版本存档依次迁移到当前 SCHEMA_VERSION。版本号相同时直接原样返回。
 * @param {object} data 已通过 validate() 的存档数据
 * @returns {object}
 */
export function migrate(data) {
  let current = data;
  while (current.schemaVersion < SCHEMA_VERSION) {
    const migrateFn = MIGRATIONS[current.schemaVersion];
    if (!migrateFn) {
      throw new Error(`[SaveSerializer] 找不到从版本 ${current.schemaVersion} 升级的迁移逻辑`);
    }
    current = migrateFn(current);
  }
  return current;
}
