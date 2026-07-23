/**
 * main.js
 * ------------------------------------------------------------------
 * 功能：Star Frontier 的应用入口。负责：
 *       1. 应用启动时展示开始菜单（新游戏/继续/读取存档/设置），
 *          真正的游戏世界（Engine 与全部子系统）直到玩家选择开始
 *          才会被组装——这样"读取存档"才能在组装之前就决定好银河种子
 *       2. startGame(options) 是原来的顶层组合根（Composition Root），
 *          组装 Phase1~6 的全部子系统，并定义每帧业务更新顺序：
 *          输入 -> [对接中：只处理解除对接] / [未对接：玩家飞船（物理+
 *          武器） -> 降落控制器 -> 对接控制器] -> 敌人群体（AI+物理+
 *          武器） -> 弹丸飞行 -> 碰撞检测 -> 阵亡清理/计分 -> 银河扇区
 *          流式加载 -> 摄像机 -> 小地图/HUD/商店面板刷新 -> 自动存档计时
 *       3. Phase7 新增暂停菜单（Esc）与设置面板，游戏进行中可以随时
 *          暂停/手动存档/调整设置
 *       阵营/任务系统（faction/、mission/）不出现在这条更新链路里——
 *       它们完全通过监听 EventBus 事件驱动（战斗/采矿/交易/降落），
 *       构造时只需要注册一次监听，之后不需要任何人主动调用它们的
 *       update()，这是 Phase5 能以极小改动量接入既有系统的关键。
 * 输入：无（浏览器加载即执行）
 * 输出：无（副作用：展示菜单、启动游戏循环、游戏画面渲染到 canvas）
 * 调用关系：本文件是唯一被 index.html 直接引入的脚本
 * 复杂度：初始化 O(1)；每帧回调 O(玩家1 + 敌人数量 + 活跃弹丸数量 + 当前地表交互物体数)
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { Engine } from './engine/Engine.js';
import { Starfield } from './scene/Starfield.js';
import { PlayerShip } from './ship/PlayerShip.js';
import { InputController } from './player/InputController.js';
import { CameraRig } from './player/CameraRig.js';
import { CollisionSystem } from './physics/CollisionSystem.js';
import { ProjectileManager } from './weapon/ProjectileManager.js';
import { ParticleSystem } from './particle/ParticleSystem.js';
import { EffectManager } from './effect/EffectManager.js';
import { EnemyShip } from './enemy/EnemyShip.js';
import { GalaxyGenerator } from './galaxy/generation/GalaxyGenerator.js';
import { GalaxyStreamer } from './galaxy/GalaxyStreamer.js';
import { LandingController } from './planet/LandingController.js';
import { DockingController } from './station/DockingController.js';
import { StationConfig } from './config/GameConfig.js';
import { RESOURCE_TYPES, getResourceDef } from './economy/ResourceDefs.js';
import { getFactionDef } from './faction/FactionDefs.js';
import { ReputationSystem, getStandingLabelFor, getTradeMultiplier } from './faction/ReputationSystem.js';
import { TechTreeSystem } from './faction/TechTreeSystem.js';
import { MissionManager } from './mission/MissionManager.js';
import { GalacticWarSimulator } from './faction/GalacticWarSimulator.js';
import { RandomEventSystem } from './galaxy/RandomEventSystem.js';
import { MODULE_DEFS } from './ship/ModuleDefs.js';
import { WEAPON_DEFS } from './weapon/WeaponDefs.js';
import { SettingsManager } from './ui/SettingsManager.js';
import { Minimap } from './ui/Minimap.js';
import { SaveManager, AUTOSAVE_SLOT_ID } from './save/SaveManager.js';
import { serialize, deserialize, validate, migrate } from './save/SaveSerializer.js';

const AUTOSAVE_INTERVAL_SECONDS = 60;
const MANUAL_SAVE_SLOT_IDS = ['slot1', 'slot2', 'slot3'];

// Phase7：正在运行的游戏会话暴露给设置面板的"实时应用"钩子。设置面板本身
// 在 initApp() 里只创建一次（开始菜单和暂停菜单共用同一个面板 DOM），
// 但只有部分设置项（反转俯仰/HUD透明度/小地图开关）值得做到"改了立刻生效"，
// 图形质量这类需要重建渲染管线的设置留到"下次开始游戏时生效"就够了，
// 不值得为此增加复杂度。没有游戏在运行时（开始菜单阶段）这里是 null。
let activeGameHooks = null;

// ---- Phase2 场景填充参数（暂放在 main.js）。Phase5 的"剿灭"任务刻意设计成
//      "消灭 N 艘敌对单位"而不是"消灭指定的那一艘"，所以完全复用下面这套
//      环境刷怪逻辑就够了，不需要为任务系统单独造一套"刷出任务目标"的
//      生成流程——任务系统只是在旁边数人头，见 mission/MissionManager.js。 ----
const INITIAL_ENEMY_COUNT = 4;
const MAX_ENEMY_COUNT = 6;
const ENEMY_SPAWN_RADIUS = [220, 380]; // 距玩家出生点的最小/最大距离
const ENEMY_RESPAWN_INTERVAL = 9; // 秒，敌人数量不足时的补充间隔

const BUY_INCREMENT = 5; // 商店面板每次点击"买入"购买的数量

// Phase8：随机事件相关常量
const SPACE_STORM_SPEED_PENALTY = 0.3; // 空间风暴期间飞船最大速度倍率的降幅
const PIRATE_RAID_SIZE_RANGE = [2, 3]; // 海盗突袭一次刷出的敌舰数量范围
const PIRATE_RAID_HARD_CAP = MAX_ENEMY_COUNT + 4; // 突袭允许敌人数量短暂超过日常上限，但不能无限叠加
const DERELICT_CREDITS_RANGE = [80, 300]; // 残骸情报奖励的信用点范围

/**
 * @param {object} options
 * @param {number} options.seed 银河生成种子（新游戏随机生成；读档则用存档里记录的种子）
 * @param {object|null} options.saveData 读档数据（已通过 validate()/migrate()），新游戏为 null
 * @param {SettingsManager} options.settingsManager
 * @param {SaveManager} options.saveManager
 */
function startGame({ seed, saveData, settingsManager, saveManager }) {
  const canvas = document.getElementById('game-canvas');
  const engine = new Engine(canvas);

  // Phase7：图形质量设置——像素比上限立即生效，星空密度在 Starfield 构造时应用
  const graphicsPreset = settingsManager.getGraphicsPreset();
  engine.rendererManager.setPixelRatioCap(graphicsPreset.pixelRatioCap);

  // ---- 场景基础内容 ----
  const starfield = new Starfield(graphicsPreset.starfieldDensity);
  engine.sceneManager.add(starfield.group, { updatable: starfield });

  // ---- 战斗子系统（顺序很重要：CollisionSystem/ProjectileManager 要先于飞船创建） ----
  const collisionSystem = new CollisionSystem();
  const projectileManager = new ProjectileManager({
    sceneManager: engine.sceneManager,
    collisionSystem,
    eventBus: engine.eventBus,
    poolSize: 150,
  });

  const particleSystem = new ParticleSystem(2000);
  engine.sceneManager.add(particleSystem.points, { updatable: particleSystem });

  // EffectManager 只订阅事件，不需要挂进场景，但要保留引用防止被 GC
  const effectManager = new EffectManager({ eventBus: engine.eventBus, particleSystem });

  // ---- 银河（Phase3/4）：流式生成扇区（含空间站与环境 NPC），飞船飞到哪里才生成哪里。
  //      Phase7 起种子不再固定，而是每局新游戏随机生成/读档时用存档记录的种子，
  //      这样"新游戏"才能真正对应"一个新的银河"，"读档"才能精确复现同一个银河 ----
  const galaxyGenerator = new GalaxyGenerator(seed);
  // Phase8：背景战争模拟——只需要 eventBus，不依赖 reputationSystem（它自己
  // 监听 combat:destroyed/mission:completed 来驱动阵营实力变化），所以可以
  // 在这里提前创建，赶在 GalaxyStreamer 需要它之前
  const warSimulator = new GalacticWarSimulator(engine.eventBus);
  // Phase8：银河随机事件（空间风暴/海盗突袭/残骸发现），同样只需要 eventBus
  const randomEventSystem = new RandomEventSystem({ eventBus: engine.eventBus });
  const galaxyStreamer = new GalaxyStreamer({
    sceneManager: engine.sceneManager,
    galaxyGenerator,
    warSimulator,
  });

  // ---- 玩家飞船 ----
  const playerShip = new PlayerShip({
    eventBus: engine.eventBus,
    projectileManager,
    collisionSystem,
  });
  engine.sceneManager.add(playerShip.object3D);

  // ---- 降落控制器（Phase3）：太空 <-> 行星表面切换、采矿、危险区域 ----
  const landingController = new LandingController({
    sceneManager: engine.sceneManager,
    playerShip,
    galaxyStreamer,
    cargoHold: playerShip.cargoHold,
    eventBus: engine.eventBus,
  });

  // ---- 对接控制器（Phase4）：空间站对接/解除对接 ----
  const dockingController = new DockingController({
    playerShip,
    galaxyStreamer,
    eventBus: engine.eventBus,
  });

  // ---- 阵营/任务系统（Phase5） ----
  const reputationSystem = new ReputationSystem(engine.eventBus);
  const techTreeSystem = new TechTreeSystem({
    playerShip,
    reputationSystem,
    eventBus: engine.eventBus,
  });
  const missionManager = new MissionManager({
    eventBus: engine.eventBus,
    reputationSystem,
    playerShip,
  });

  // ---- 敌人群体 ----
  /** @type {EnemyShip[]} */
  const enemies = [];
  let killCount = 0;
  let gameOver = false;
  let enemyRespawnTimer = ENEMY_RESPAWN_INTERVAL;

  // Phase7：读档——所有相关系统都已就绪，把存档数据重放回活对象上。
  // 必须在这里做（而不是更早），因为 deserialize() 需要 playerShip/
  // reputationSystem/techTreeSystem/warSimulator/missionManager 全部存在
  if (saveData) {
    const restored = deserialize(saveData, {
      playerShip,
      reputationSystem,
      techTreeSystem,
      warSimulator,
      missionManager,
    });
    killCount = restored.killCount;
  }

  /**
   * @param {object} [options]
   * @param {number} [options.attackAngle] 交战时盘旋点相对目标的固定角度（弧度）——
   *        编队出生时用来给每个成员分配不同角度，实现从不同方向包抄
   * @param {THREE.Vector3} [options.spawnPositionOverride] 指定出生点（编队用，
   *        所有成员共享同一个中心点附近，带小范围抖动避免完全重叠）；
   *        不传则用默认的"玩家周围环形区域随机取点"
   * @returns {EnemyShip}
   */
  function spawnEnemy({ attackAngle, spawnPositionOverride } = {}) {
    let spawnPosition;
    if (spawnPositionOverride) {
      const jitter = 18; // 编队内成员之间的随机抖动范围，避免完全重叠又不会散得太开
      spawnPosition = spawnPositionOverride.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * jitter,
          (Math.random() - 0.5) * jitter * 0.4,
          (Math.random() - 0.5) * jitter
        )
      );
    } else {
      // 在玩家当前位置周围的一个环形区域内随机取点，避免敌人直接刷在玩家脸上。
      // 注意：不是世界原点——Phase3 银河流式加载上线后，玩家可能已经飞出
      // 原点所在扇区很远，如果还按世界原点生成，敌人会莫名其妙刷在一个
      // 玩家根本不在的地方。这个偏移量直接加在玩家当前坐标上，任何时候
      // 调用都正确
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * 0.5;
      const radius =
        ENEMY_SPAWN_RADIUS[0] + Math.random() * (ENEMY_SPAWN_RADIUS[1] - ENEMY_SPAWN_RADIUS[0]);
      spawnPosition = new THREE.Vector3(
        playerShip.object3D.position.x + Math.cos(angle) * radius,
        playerShip.object3D.position.y + Math.sin(elevation) * radius * 0.4,
        playerShip.object3D.position.z + Math.sin(angle) * radius
      );
    }

    const enemy = new EnemyShip({
      eventBus: engine.eventBus,
      projectileManager,
      collisionSystem,
      spawnPosition,
      attackAngle,
    });
    engine.sceneManager.add(enemy.object3D);
    enemies.push(enemy);
    return enemy;
  }

  /**
   * Phase8：舰队AI——成组生成一队敌人，共享同一个出生位置附近，并把 360°
   * 平均分配给每个成员作为交战包抄角度（见 enemy/EnemyAIController.js
   * 的 attackAngle），让它们围攻玩家时自然从不同方向包抄，而不是挤在
   * 同一侧。真正的编队跟随飞行/领队让位不在本阶段范围内（见该文件顶部
   * 注释的取舍说明），"出生在一起 + 包抄角度错开"已经能让玩家明显
   * 感觉到"这是一队敌人在配合"。
   * @param {number} size 队伍规模
   */
  function spawnEnemySquad(size) {
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.5) * 0.5;
    const radius =
      ENEMY_SPAWN_RADIUS[0] + Math.random() * (ENEMY_SPAWN_RADIUS[1] - ENEMY_SPAWN_RADIUS[0]);
    const squadCenter = new THREE.Vector3(
      playerShip.object3D.position.x + Math.cos(angle) * radius,
      playerShip.object3D.position.y + Math.sin(elevation) * radius * 0.4,
      playerShip.object3D.position.z + Math.sin(angle) * radius
    );

    const baseAttackAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < size; i++) {
      const attackAngle = baseAttackAngle + (i / size) * Math.PI * 2;
      spawnEnemy({ attackAngle, spawnPositionOverride: squadCenter });
    }
  }

  // 初始种群：用 2~3 人小队填满 INITIAL_ENEMY_COUNT，而不是清一色互不相干
  // 的独狼，直接体现"舰队AI"
  let remainingInitialSpawns = INITIAL_ENEMY_COUNT;
  while (remainingInitialSpawns > 0) {
    const squadSize = Math.min(remainingInitialSpawns, 2 + Math.floor(Math.random() * 2));
    spawnEnemySquad(squadSize);
    remainingInitialSpawns -= squadSize;
  }

  // 战斗事件：敌人阵亡 -> 计分+从场景清理；玩家阵亡 -> 进入 GameOver
  engine.eventBus.on('combat:destroyed', (payload) => {
    if (payload.entityId === playerShip.health.entityId) {
      gameOver = true;
      return;
    }
    const idx = enemies.findIndex((e) => e.health.entityId === payload.entityId);
    if (idx !== -1) {
      const enemy = enemies[idx];
      engine.sceneManager.remove(enemy.object3D);
      enemy.dispose();
      enemies.splice(idx, 1);
      killCount += 1;
    }
  });

  const inputController = new InputController();
  inputController.setInvertPitch(settingsManager.values.invertPitch);
  const cameraRig = new CameraRig(engine.camera);
  cameraRig.snapTo(playerShip.object3D); // 避免读档后摄像机从旧位置"飞"过来追赶飞船

  // ---- HUD DOM 引用 ----
  const hud = {
    speed: document.getElementById('hud-speed'),
    throttle: document.getElementById('hud-throttle'),
    fps: document.getElementById('hud-fps'),
    boostIndicator: document.getElementById('hud-boost'),
    hullFill: document.getElementById('hud-hull-fill'),
    hullValue: document.getElementById('hud-hull-value'),
    shieldFill: document.getElementById('hud-shield-fill'),
    shieldValue: document.getElementById('hud-shield-value'),
    energyFill: document.getElementById('hud-energy-fill'),
    energyValue: document.getElementById('hud-energy-value'),
    secondaryIndicator: document.getElementById('hud-secondary'),
    enemyCount: document.getElementById('hud-enemy-count'),
    killCount: document.getElementById('hud-kill-count'),
    gameOverOverlay: document.getElementById('game-over-overlay'),
    sectorName: document.getElementById('hud-sector-name'),
    sectorTerritory: document.getElementById('hud-sector-territory'),
    cargoValue: document.getElementById('hud-cargo-value'),
    cargoCapacity: document.getElementById('hud-cargo-capacity'),
    credits: document.getElementById('hud-credits'),
    landPrompt: document.getElementById('hud-land-prompt'),
    toast: document.getElementById('hud-toast'),
    minimapContainer: document.getElementById('hud-minimap'),
  };

  // Phase7：小地图/雷达——按设置决定是否创建。setMinimapEnabled 同时供
  // 设置面板在游戏进行中实时开关调用
  let minimap = null;
  function setMinimapEnabled(enabled) {
    if (enabled && !minimap) {
      minimap = new Minimap({ rangeWorldUnits: 900 });
      hud.minimapContainer.appendChild(minimap.svgElement);
    }
    hud.minimapContainer.classList.toggle('hidden', !enabled);
  }
  setMinimapEnabled(settingsManager.values.showMinimap);

  // ---- 商店面板 DOM 引用（Phase4/5） ----
  const shopPanel = {
    root: document.getElementById('shop-panel'),
    stationName: document.getElementById('shop-station-name'),
    credits: document.getElementById('shop-credits'),
    marketList: document.getElementById('shop-market-list'),
    hullRatio: document.getElementById('shop-hull-ratio'),
    repairBtn: document.getElementById('shop-repair-btn'),
    repairCost: document.getElementById('shop-repair-cost'),
    closeBtn: document.getElementById('shop-close-btn'),
    factionInfo: document.getElementById('shop-faction-info'),
    factionName: document.getElementById('shop-faction-name'),
    factionStanding: document.getElementById('shop-faction-standing'),
    missionSection: document.getElementById('shop-mission-section'),
    missionList: document.getElementById('shop-mission-list'),
    techtreeSection: document.getElementById('shop-techtree-section'),
    techtreeList: document.getElementById('shop-techtree-list'),
    refitList: document.getElementById('shop-refit-list'),
  };

  let toastHideTimer = null;
  /** 在屏幕上方短暂显示一行提示，用于降落/采矿/对接/交易等一次性反馈 */
  function showToast(text) {
    hud.toast.textContent = text;
    hud.toast.classList.add('visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => hud.toast.classList.remove('visible'), 2400);
  }

  engine.eventBus.on('planet:landed', ({ type }) => showToast(`降落成功 · 地表类型：${type}`));
  engine.eventBus.on('planet:takeoff', () => showToast('已起飞，返回太空'));
  engine.eventBus.on('resource:mined', ({ resourceId, accepted, overflowed }) => {
    const name = getResourceDef(resourceId).name;
    const msg =
      overflowed > 0
        ? `采集到 ${name} x${accepted}（货舱已满，损失 ${overflowed.toFixed(0)}）`
        : `采集到 ${name} x${accepted.toFixed(0)}`;
    showToast(msg);
  });

  engine.eventBus.on('station:docked', ({ name }) => {
    showToast(`对接成功 · ${name}`);
    shopPanel.root.classList.add('visible');
    refreshShopPanel();
  });
  engine.eventBus.on('station:undocked', () => {
    showToast('已解除对接');
    shopPanel.root.classList.remove('visible');
  });

  engine.eventBus.on('mission:completed', ({ mission }) => {
    showToast(`任务完成：${mission.title} · +${mission.rewardCredits}信用点 +${mission.rewardReputation}声望`);
    refreshShopPanel();
  });
  engine.eventBus.on('mission:abandoned', ({ mission }) => {
    showToast(`已放弃任务：${mission.title}`);
  });
  engine.eventBus.on('techtree:unlocked', ({ node }) => {
    showToast(`科技解锁：${node.name}`);
  });
  engine.eventBus.on('war:territoryChanged', ({ sectorKey, from, to }) => {
    // 只在玩家当前视野附近（已加载的扇区）才提示，播报玩家感知不到的
    // 远方局势变化只会显得莫名其妙
    if (!galaxyStreamer.isSectorLoaded(sectorKey)) return;
    const fromName = from ? getFactionDef(from).name : '无主星域';
    const toName = getFactionDef(to).name;
    showToast(`局势变化：附近星域从「${fromName}」易手给「${toName}」`);
  });

  // Phase8：随机事件的具体应用逻辑。RandomEventSystem 本身只负责"决定
  // 发生什么"，不认识 PlayerShip/EnemyShip，这里才是真正调整数值/
  // 生成敌人/发放奖励的地方
  engine.eventBus.on('event:spaceStormStart', ({ duration }) => {
    playerShip.physics.maxSpeedMultiplier -= SPACE_STORM_SPEED_PENALTY;
    showToast(`⚠ 空间风暴来袭，飞船机动性下降，预计持续 ${Math.round(duration)} 秒`);
  });
  engine.eventBus.on('event:spaceStormEnd', () => {
    playerShip.physics.maxSpeedMultiplier += SPACE_STORM_SPEED_PENALTY;
    showToast('空间风暴已平息');
  });
  engine.eventBus.on('event:pirateRaid', () => {
    const [minSize, maxSize] = PIRATE_RAID_SIZE_RANGE;
    const rolledSize = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
    const raidSize = Math.min(rolledSize, Math.max(0, PIRATE_RAID_HARD_CAP - enemies.length));
    if (raidSize <= 0) return;
    spawnEnemySquad(raidSize);
    showToast(`⚠ 海盗突袭！${raidSize} 艘敌舰逼近，正在包抄`);
  });
  engine.eventBus.on('event:derelictFound', () => {
    const [minCredits, maxCredits] = DERELICT_CREDITS_RANGE;
    const bonusCredits = Math.round(minCredits + Math.random() * (maxCredits - minCredits));
    playerShip.wallet.addCredits(bonusCredits);
    showToast(`截获远古残骸坐标情报，出售获得 ${bonusCredits} 信用点`);
  });

  shopPanel.closeBtn.addEventListener('click', () => dockingController.undock());

  shopPanel.repairBtn.addEventListener('click', () => {
    const missing = playerShip.health.maxHull - playerShip.health.hull;
    if (missing <= 0) return;
    const affordableHull = Math.floor(
      playerShip.wallet.credits / StationConfig.REPAIR_COST_PER_HULL_POINT
    );
    const repairAmount = Math.min(missing, affordableHull);
    if (repairAmount <= 0) return;
    const cost = Math.round(repairAmount * StationConfig.REPAIR_COST_PER_HULL_POINT);
    playerShip.wallet.spendCredits(cost);
    playerShip.health.repairHull(repairAmount);
    showToast(`维修 ${repairAmount.toFixed(0)} 点装甲，花费 ${cost} 信用点`);
    refreshShopPanel();
  });

  /**
   * 构建市场面板里单个资源的一行（名称/单价/持有量/买入卖出按钮）
   * @param {import('./economy/ResourceDefs.js').ResourceDef} resourceDef
   * @param {import('./economy/Market.js').Market} market
   * @param {number} buyMultiplier 声望折扣后的买入价格倍率
   * @param {number} sellMultiplier 声望折扣后的卖出价格倍率
   */
  function buildMarketRow(resourceDef, market, buyMultiplier, sellMultiplier) {
    const row = document.createElement('div');
    row.className = 'shop-panel__cargo-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'shop-panel__resource-name';
    nameEl.textContent = resourceDef.name;

    const basePrice = market.getPrice(resourceDef.id);
    const buyPrice = Math.round(basePrice * buyMultiplier);
    const sellPrice = Math.round(basePrice * sellMultiplier);
    const priceEl = document.createElement('span');
    priceEl.className = 'shop-panel__resource-price';
    priceEl.textContent =
      buyMultiplier === sellMultiplier ? `${buyPrice}cr` : `买${buyPrice}/卖${sellPrice}cr`;

    const held = playerShip.cargoHold.contents.get(resourceDef.id) || 0;
    const heldEl = document.createElement('span');
    heldEl.className = 'shop-panel__resource-held';
    heldEl.textContent = held.toFixed(0);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'shop-panel__row-actions';

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'shop-panel__action-btn';
    buyBtn.textContent = `买入 x${BUY_INCREMENT}`;
    const spaceLeft = playerShip.cargoHold.capacity - playerShip.cargoHold.totalStored;
    buyBtn.disabled = spaceLeft <= 0 || playerShip.wallet.credits < buyPrice;
    buyBtn.addEventListener('click', () => {
      const result = market.buy(
        resourceDef.id,
        BUY_INCREMENT,
        playerShip.cargoHold,
        playerShip.wallet,
        buyMultiplier
      );
      if (result.success) {
        showToast(`购入 ${resourceDef.name} x${result.amount}，花费 ${result.credits} 信用点`);
      } else {
        showToast(result.reason === 'cargo_full' ? '货舱已满' : '信用点不足');
      }
      refreshShopPanel();
    });

    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.className = 'shop-panel__action-btn';
    sellBtn.textContent = '卖出全部';
    sellBtn.disabled = held <= 0;
    sellBtn.addEventListener('click', () => {
      const result = market.sell(
        resourceDef.id,
        held,
        playerShip.cargoHold,
        playerShip.wallet,
        sellMultiplier
      );
      if (result.success) {
        showToast(`售出 ${resourceDef.name} x${result.amount}，获得 ${result.credits} 信用点`);
        engine.eventBus.emit('economy:sold', {
          resourceId: resourceDef.id,
          amount: result.amount,
          credits: result.credits,
        });
      }
      refreshShopPanel();
    });

    actionsEl.append(buyBtn, sellBtn);
    row.append(nameEl, priceEl, heldEl, actionsEl);
    return row;
  }

  /**
   * 构建任务板里单个任务的一行
   * @param {object} mission
   * @param {'offer'|'active'} kind
   */
  function buildMissionRow(mission, kind) {
    const row = document.createElement('div');
    row.className = kind === 'active' ? 'shop-panel__mission-row active' : 'shop-panel__mission-row';

    const title = document.createElement('div');
    title.className = 'shop-panel__mission-title';
    title.textContent = mission.title;

    const desc = document.createElement('div');
    desc.className = 'shop-panel__mission-desc';
    desc.textContent = mission.description;

    const reward = document.createElement('div');
    reward.className = 'shop-panel__mission-reward';
    reward.textContent = `奖励：${mission.rewardCredits} 信用点 · 声望 +${mission.rewardReputation}`;

    row.append(title, desc, reward);

    if (kind === 'active') {
      const progress = document.createElement('div');
      progress.className = 'shop-panel__mission-progress';
      progress.textContent = `进度：${mission.progress} / ${mission.targetCount}`;
      row.appendChild(progress);

      const abandonBtn = document.createElement('button');
      abandonBtn.type = 'button';
      abandonBtn.className = 'shop-panel__action-btn shop-panel__action-btn--danger';
      abandonBtn.textContent = '放弃任务';
      abandonBtn.addEventListener('click', () => {
        missionManager.abandonActiveMission();
        refreshShopPanel();
      });
      row.appendChild(abandonBtn);
    } else {
      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'shop-panel__action-btn';
      acceptBtn.textContent = '接取任务';
      acceptBtn.disabled = !!missionManager.activeMission;
      acceptBtn.addEventListener('click', () => {
        if (missionManager.acceptMission(mission)) {
          showToast(`已接取：${mission.title}`);
        }
        refreshShopPanel();
      });
      row.appendChild(acceptBtn);
    }

    return row;
  }

  /**
   * 构建阵营科技树里单个节点的一行
   * @param {object} node
   */
  function buildTechNodeRow(node) {
    const row = document.createElement('div');
    row.className = node.unlocked ? 'shop-panel__tech-row unlocked' : 'shop-panel__tech-row';

    const header = document.createElement('div');
    header.className = 'shop-panel__tech-row-header';

    const name = document.createElement('span');
    name.className = 'shop-panel__tech-name';
    name.textContent = node.name;

    const status = document.createElement('span');
    status.className = 'shop-panel__tech-status';
    status.textContent = node.unlocked ? '已解锁' : `需要：${getStandingLabelFor(node.requiredStanding)}`;

    header.append(name, status);

    const desc = document.createElement('div');
    desc.className = 'shop-panel__tech-desc';
    desc.textContent = node.description;

    row.append(header, desc);
    return row;
  }

  /**
   * 构建改装面板里一个"可购买/安装"选项按钮
   * @param {string} label
   * @param {number} cost
   * @param {boolean} disabled
   * @param {()=>void} onClick
   */
  function buildRefitOptionButton(label, cost, disabled, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-panel__action-btn';
    btn.textContent = cost > 0 ? `${label}（${cost}cr）` : `${label}（免费）`;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * 构建数值类改装槽位的一整行（引擎/装甲/护盾/反应堆）
   * @param {'engine'|'armor'|'shield'|'reactor'} slot
   * @param {string} slotLabel
   */
  function buildRefitStatRow(slot, slotLabel) {
    const row = document.createElement('div');
    row.className = 'shop-panel__refit-row';

    const current = playerShip.loadout.installed[slot];

    const header = document.createElement('div');
    header.className = 'shop-panel__refit-header';
    const label = document.createElement('span');
    label.className = 'shop-panel__refit-label';
    label.textContent = slotLabel;
    const currentName = document.createElement('span');
    currentName.className = 'shop-panel__refit-current';
    currentName.textContent = `当前：${current.name}`;
    header.append(label, currentName);
    row.appendChild(header);

    const desc = document.createElement('div');
    desc.className = 'shop-panel__refit-desc';
    desc.textContent = current.description;
    row.appendChild(desc);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'shop-panel__refit-options';
    for (const moduleDef of MODULE_DEFS[slot]) {
      const isCurrent = moduleDef.id === current.id;
      const canAfford = playerShip.wallet.credits >= moduleDef.cost;
      const btn = buildRefitOptionButton(moduleDef.name, moduleDef.cost, isCurrent || !canAfford, () => {
        if (!playerShip.wallet.spendCredits(moduleDef.cost)) {
          showToast('信用点不足');
          return;
        }
        playerShip.loadout.install(slot, moduleDef);
        showToast(`已安装：${moduleDef.name}`);
        refreshShopPanel();
      });
      optionsRow.appendChild(btn);
    }
    row.appendChild(optionsRow);

    return row;
  }

  /**
   * 构建武器改装槽位的一整行（主武器/副武器）
   * @param {'primaryWeapon'|'secondaryWeapon'} slot
   * @param {string} slotLabel
   */
  function buildRefitWeaponRow(slot, slotLabel) {
    const row = document.createElement('div');
    row.className = 'shop-panel__refit-row';

    const currentId = playerShip.loadout.installedWeaponIds[slot];
    const currentDef = WEAPON_DEFS.get(currentId);

    const header = document.createElement('div');
    header.className = 'shop-panel__refit-header';
    const label = document.createElement('span');
    label.className = 'shop-panel__refit-label';
    label.textContent = slotLabel;
    const currentName = document.createElement('span');
    currentName.className = 'shop-panel__refit-current';
    currentName.textContent = `当前：${currentDef ? currentDef.name : '未知'}`;
    header.append(label, currentName);
    row.appendChild(header);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'shop-panel__refit-options';
    for (const weaponDef of WEAPON_DEFS.values()) {
      const isCurrent = weaponDef.id === currentId;
      const canAfford = playerShip.wallet.credits >= weaponDef.cost;
      const btn = buildRefitOptionButton(weaponDef.name, weaponDef.cost, isCurrent || !canAfford, () => {
        if (!playerShip.wallet.spendCredits(weaponDef.cost)) {
          showToast('信用点不足');
          return;
        }
        playerShip.loadout.installWeapon(slot, weaponDef);
        showToast(`已安装：${weaponDef.name}`);
        refreshShopPanel();
      });
      optionsRow.appendChild(btn);
    }
    row.appendChild(optionsRow);

    return row;
  }

  /** 对接期间每次交易后调用，重绘整个商店面板（内容量不大，重建比精细 diff 更简单可靠） */
  function refreshShopPanel() {
    if (!dockingController.isDocked || !dockingController.dockedStation) return;
    const dockedStation = dockingController.dockedStation;
    const station = dockedStation.stationInstance;
    const factionId = dockedStation.controllingFactionId;

    shopPanel.stationName.textContent = dockedStation.data.name;
    shopPanel.credits.textContent = playerShip.wallet.credits.toString();

    // ---- 阵营信息 / 任务板 / 科技树：只有归属某个阵营的站点才有 ----
    let buyMultiplier = 1;
    let sellMultiplier = 1;

    if (factionId) {
      const faction = getFactionDef(factionId);
      const standing = reputationSystem.getStanding(factionId);
      const score = reputationSystem.getScore(factionId);

      shopPanel.factionInfo.classList.remove('hidden');
      shopPanel.factionName.textContent = faction.name;
      shopPanel.factionStanding.textContent = `${reputationSystem.getStandingLabel(factionId)}（${score}）`;
      shopPanel.factionStanding.className = `shop-panel__faction-standing standing--${standing}`;

      shopPanel.missionSection.classList.remove('hidden');
      shopPanel.missionList.innerHTML = '';
      if (missionManager.activeMission) {
        shopPanel.missionList.appendChild(buildMissionRow(missionManager.activeMission, 'active'));
      } else {
        const offers = missionManager.getOffersForFaction(factionId);
        if (offers.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'shop-panel__mission-empty';
          empty.textContent = '暂无更多任务，请稍后再来查看。';
          shopPanel.missionList.appendChild(empty);
        } else {
          for (const offer of offers) {
            shopPanel.missionList.appendChild(buildMissionRow(offer, 'offer'));
          }
        }
      }

      shopPanel.techtreeSection.classList.remove('hidden');
      shopPanel.techtreeList.innerHTML = '';
      const nodes = techTreeSystem.getAllNodesWithStatus().filter((n) => n.factionId === factionId);
      for (const node of nodes) {
        shopPanel.techtreeList.appendChild(buildTechNodeRow(node));
      }

      buyMultiplier = getTradeMultiplier(standing, 'buy');
      sellMultiplier = getTradeMultiplier(standing, 'sell');
    } else {
      shopPanel.factionInfo.classList.add('hidden');
      shopPanel.missionSection.classList.add('hidden');
      shopPanel.techtreeSection.classList.add('hidden');
    }

    shopPanel.marketList.innerHTML = '';
    for (const resourceDef of RESOURCE_TYPES) {
      shopPanel.marketList.appendChild(
        buildMarketRow(resourceDef, station.market, buyMultiplier, sellMultiplier)
      );
    }

    const missing = playerShip.health.maxHull - playerShip.health.hull;
    shopPanel.hullRatio.textContent = Math.round(playerShip.health.hullRatio * 100).toString();
    const affordableHull = Math.floor(
      playerShip.wallet.credits / StationConfig.REPAIR_COST_PER_HULL_POINT
    );
    const repairAmount = Math.min(missing, affordableHull);
    shopPanel.repairCost.textContent = Math.round(
      repairAmount * StationConfig.REPAIR_COST_PER_HULL_POINT
    ).toString();
    shopPanel.repairBtn.disabled = missing <= 0 || repairAmount <= 0;

    // ---- Phase6：飞船改装（任何站点都提供基础改装服务，不受阵营归属限制） ----
    shopPanel.refitList.innerHTML = '';
    shopPanel.refitList.appendChild(buildRefitStatRow('engine', '引擎'));
    shopPanel.refitList.appendChild(buildRefitStatRow('armor', '装甲'));
    shopPanel.refitList.appendChild(buildRefitStatRow('shield', '护盾'));
    shopPanel.refitList.appendChild(buildRefitStatRow('reactor', '反应堆'));
    shopPanel.refitList.appendChild(buildRefitWeaponRow('primaryWeapon', '主武器'));
    shopPanel.refitList.appendChild(buildRefitWeaponRow('secondaryWeapon', '副武器'));
  }

  /**
   * 为玩家的追踪导弹（副武器）挑选一个索敌目标：范围内最近的存活敌人。
   * Phase2 用简单的「最近距离」策略；真正的雷达/锁定 UI 属于后续 UI 阶段。
   * @returns {THREE.Object3D|null}
   */
  function pickHomingTarget() {
    let closest = null;
    let closestDistSq = Infinity;
    for (const enemy of enemies) {
      if (enemy.health.isDestroyed) continue;
      const distSq = playerShip.object3D.position.distanceToSquared(enemy.object3D.position);
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = enemy;
      }
    }
    return closest ? closest.object3D : null;
  }

  /**
   * 每帧业务更新：输入 -> [对接中/未对接分支] -> 敌人群体 -> 弹丸 -> 碰撞
   * -> 补充刷怪 -> 银河扇区流式加载（含 NPC/空间站） -> 摄像机 -> HUD
   * @param {number} dt 秒
   */
  function update(dt) {
    const inputState = inputController.getState();

    if (!gameOver) {
      if (dockingController.isDocked) {
        // 对接期间飞船原地停靠，只处理"解除对接"这一个输入，
        // 不驱动飞行物理/武器——这是刻意的"菜单态暂停"体验
        dockingController.update(dt, inputState);
      } else {
        const homingTarget = pickHomingTarget();
        playerShip.update(dt, inputState, homingTarget);
        landingController.update(dt, inputState);
        dockingController.update(dt, inputState);
      }

      for (const enemy of enemies) {
        enemy.update(dt, playerShip);
      }

      // 弹丸飞行 + 碰撞检测：必须在所有飞船本帧移动完成后进行，
      // 保证碰撞判定使用的是本帧最新位置
      projectileManager.update(dt);
      collisionSystem.update();

      // 敌人数量不足时按间隔补充，保持长期可玩性（避免打光就没敌人了）
      enemyRespawnTimer -= dt;
      if (enemyRespawnTimer <= 0 && enemies.length < MAX_ENEMY_COUNT) {
        // 三分之一概率补充一支 2 人小队而不是单机，前提是加了以后还不会
        // 超过日常上限——避免"补给"意外变成一次小型突袭
        if (Math.random() < 0.33 && enemies.length + 2 <= MAX_ENEMY_COUNT) {
          spawnEnemySquad(2);
        } else {
          spawnEnemy();
        }
        enemyRespawnTimer = ENEMY_RESPAWN_INTERVAL;
      }

      // Phase8：背景战争模拟——不管玩家在太空/降落/对接，银河局势都在推进，
      // 这正是"银河不是静止的，玩家离线以后也继续模拟"这句需求的精神
      // （虽然这里"离线"指的是玩家在别处忙别的事，不是真的离线，浏览器
      // 标签页不活跃时 rAF 本来就会被节流/暂停，做不到真正的离线模拟）
      warSimulator.update(dt);

      // Phase8：银河随机事件——降落/对接时不触发新事件（不然海盗突袭会刷在
      // 玩家去不了的地表舞台坐标附近，变成永远遇不到的"幽灵敌人"，白白
      // 占用敌人数量上限），但已经在进行中的空间风暴计时器仍然正常倒数
      const eventSectorKey =
        !landingController.isLanded && !dockingController.isDocked
          ? galaxyStreamer.currentSectorKey
          : null;
      randomEventSystem.update(dt, eventSectorKey);

      // 银河流式加载：只在太空模式下才有意义——降落时飞船被搬到远离扇区
      // 网格的地表舞台坐标，那个坐标恰好落在扇区(0,0)，此时重新计算加载
      // 集合只会白白生成一堆无关扇区，起飞后还要再算一次，纯属浪费。
      // 对接期间飞船原地不动，扇区键不会变化，调用与否结果一样，
      // 但不调用可以省掉一次（哪怕很小的）距离判断开销。
      if (!landingController.isLanded && !dockingController.isDocked) {
        galaxyStreamer.update(playerShip.object3D.position);
      }
    } else {
      // GameOver 后仍然推进弹丸/碰撞，让已经发射的弹幕和爆炸特效自然收尾，
      // 但不再驱动飞船物理与武器，营造"战斗已经定格"的观感
      projectileManager.update(dt);
    }

    cameraRig.update(dt, playerShip.object3D, playerShip.telemetry);
    if (minimap) minimap.update({ playerShip, galaxyStreamer, enemies });
    refreshHud();
    if (dockingController.isDocked) refreshShopPanel();

    // Phase7：自动存档——每隔一段时间静默写入专用的 autosave 槽位，
    // 不打断玩家操作，也不弹 toast 刷存在感（避免每分钟打断一次的烦躁感）
    if (settingsManager.values.autosaveEnabled && !gameOver) {
      autosaveTimer -= dt;
      if (autosaveTimer <= 0) {
        autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
        performSave(AUTOSAVE_SLOT_ID);
      }
    }
  }

  let autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;

  /**
   * 把当前游戏状态序列化并写入指定存档槽位
   * @param {string} slotId
   * @returns {Promise<boolean>} 是否保存成功
   */
  async function performSave(slotId) {
    try {
      const payload = serialize({
        playerShip,
        galaxySeed: seed,
        reputationSystem,
        warSimulator,
        missionManager,
        killCount,
      });
      await saveManager.writeSlot(slotId, payload);
      return true;
    } catch (err) {
      console.error('[main] 存档失败', err);
      return false;
    }
  }

  function refreshHud() {
    const t = playerShip.telemetry;
    hud.speed.textContent = t.speed.toFixed(0);
    hud.throttle.textContent = Math.round(t.throttle * 100).toString();
    hud.fps.textContent = engine.loop.stats.fps.toString();
    hud.boostIndicator.classList.toggle('active', t.boosting);

    hud.hullFill.style.width = `${Math.round(t.hullRatio * 100)}%`;
    hud.hullValue.textContent = Math.round(t.hullRatio * 100).toString();
    hud.hullFill.classList.toggle('critical', t.hullRatio < 0.3);

    hud.shieldFill.style.width = `${Math.round(t.shieldRatio * 100)}%`;
    hud.shieldValue.textContent = Math.round(t.shieldRatio * 100).toString();

    hud.energyFill.style.width = `${Math.round(t.energyRatio * 100)}%`;
    hud.energyValue.textContent = Math.round(t.energyRatio * 100).toString();

    const secondaryMount = playerShip.weaponSystem
      .getMountsSnapshot()
      .find((m) => m.triggerId === 'secondary');
    if (secondaryMount) {
      hud.secondaryIndicator.classList.toggle('ready', secondaryMount.cooldownRatio >= 1);
    }

    hud.enemyCount.textContent = enemies.length.toString();
    hud.killCount.textContent = killCount.toString();

    const sectorData = galaxyStreamer.currentSectorData;
    hud.sectorName.textContent = landingController.isLanded
      ? '地表'
      : sectorData
        ? sectorData.sectorName
        : '未知星域';
    if (landingController.isLanded || !sectorData) {
      hud.sectorTerritory.textContent = '—';
    } else {
      const controllingFactionId = galaxyStreamer.currentControllingFactionId;
      hud.sectorTerritory.textContent = controllingFactionId
        ? getFactionDef(controllingFactionId).name
        : '无主星域';
    }

    hud.cargoValue.textContent = Math.round(playerShip.cargoHold.totalStored).toString();
    hud.cargoCapacity.textContent = playerShip.cargoHold.capacity.toString();
    hud.credits.textContent = playerShip.wallet.credits.toString();

    if (dockingController.isDocked) {
      hud.landPrompt.classList.remove('visible'); // 商店面板已经是主要交互界面，不再重复提示
    } else if (landingController.isLanded) {
      hud.landPrompt.textContent = '[L] 起飞　[G] 采集附近资源';
      hud.landPrompt.classList.add('visible');
    } else if (landingController.canLand) {
      hud.landPrompt.textContent = '[L] 降落';
      hud.landPrompt.classList.add('visible');
    } else if (dockingController.canDock) {
      hud.landPrompt.textContent = '[K] 对接';
      hud.landPrompt.classList.add('visible');
    } else {
      hud.landPrompt.classList.remove('visible');
    }

    hud.gameOverOverlay.classList.toggle('visible', gameOver);
  }

  // Phase7：暂停菜单（Esc 切换）。对接期间飞船已经处于"菜单态"
  // （商店面板打开、飞行输入被跳过），不需要再叠加一层暂停菜单，
  // 按 Esc 直接忽略即可，避免两层菜单互相干扰
  const pauseMenu = {
    root: document.getElementById('pause-menu'),
    resumeBtn: document.getElementById('pause-resume-btn'),
    settingsBtn: document.getElementById('pause-settings-btn'),
    quitBtn: document.getElementById('pause-quit-btn'),
  };

  let isPaused = false;
  function togglePause() {
    if (dockingController.isDocked) return;
    isPaused = !isPaused;
    if (isPaused) {
      engine.stop();
      pauseMenu.root.classList.add('visible');
    } else {
      pauseMenu.root.classList.remove('visible');
      engine.start(update);
    }
  }

  pauseMenu.resumeBtn.addEventListener('click', togglePause);
  pauseMenu.settingsBtn.addEventListener('click', () => showSettingsPanel());
  pauseMenu.quitBtn.addEventListener('click', () => {
    // 最简单可靠的"返回主菜单"方式：重新加载页面，干净重置全部 WebGL/
    // 场景状态，不需要手写一套完整的场景拆卸逻辑
    window.location.reload();
  });

  for (const slotId of MANUAL_SAVE_SLOT_IDS) {
    const btn = document.getElementById(`pause-save-${slotId}-btn`);
    if (!btn) continue;
    btn.addEventListener('click', async () => {
      const ok = await performSave(slotId);
      showToast(ok ? '存档成功' : '存档失败');
    });
  }

  // 暴露给设置面板做"实时应用"，以及给全局 Esc 处理器调用暂停/继续
  // （见文件顶部 activeGameHooks 注释）
  activeGameHooks = {
    setInvertPitch: (v) => inputController.setInvertPitch(v),
    setHudOpacity: (v) => {
      document.getElementById('hud-root').style.opacity = String(v);
    },
    setMinimapEnabled,
    togglePause,
  };

  engine.start(update);

  // 方便在浏览器控制台调试（不影响生产逻辑，仅开发期可见）
  window.__STAR_FRONTIER__ = {
    engine,
    playerShip,
    enemies,
    starfield,
    cameraRig,
    collisionSystem,
    projectileManager,
    particleSystem,
    galaxyStreamer,
    landingController,
    dockingController,
    reputationSystem,
    techTreeSystem,
    missionManager,
  };
}

window.addEventListener('DOMContentLoaded', initApp);

/**
 * 应用启动入口：展示开始菜单，处理新游戏/读档/设置。真正的游戏世界
 * （Engine 与全部子系统）只有在玩家选择"新游戏"或"读取存档"之后才会
 * 被组装——这样"读取存档"才能在组装游戏世界之前就决定好银河种子，
 * 不需要先造一个银河再重新造一个。
 */
async function initApp() {
  const settingsManager = new SettingsManager();
  const saveManager = new SaveManager();
  await saveManager.open();

  const startMenu = {
    root: document.getElementById('start-menu'),
    newGameBtn: document.getElementById('start-new-game-btn'),
    settingsBtn: document.getElementById('start-settings-btn'),
    slotList: document.getElementById('start-slot-list'),
  };

  setupSettingsPanel(settingsManager);

  // Phase7：全局 Esc 处理——只注册一次（不像暂停菜单本身，每次 startGame()
  // 都是全新的一局，不需要重新绑定这个）。优先关闭已经打开的设置面板，
  // 否则才尝试切换暂停状态；游戏还没开始时 activeGameHooks 为 null，
  // 直接安全地什么都不做
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    const settingsPanelEl = document.getElementById('settings-panel');
    if (settingsPanelEl.classList.contains('visible')) {
      hideSettingsPanel();
      return;
    }
    activeGameHooks?.togglePause();
  });

  // 双重保险：虽然开始菜单一旦隐藏就会因为 pointer-events:none 而无法
  // 再被点到，但显式加一个标记更清楚地表达意图，也防止未来改动样式时
  // 不小心把这层保护去掉
  let gameStarted = false;

  startMenu.newGameBtn.addEventListener('click', () => {
    if (gameStarted) return;
    gameStarted = true;
    // 32 位无符号整数种子，配合 GalaxyGenerator/SeededRandom 的确定性
    // 生成，保证"这一局"的银河从此以后飞到哪都是同一个银河
    const seed = Math.floor(Math.random() * 0xffffffff);
    startMenu.root.classList.remove('visible');
    startGame({ seed, saveData: null, settingsManager, saveManager });
  });

  startMenu.settingsBtn.addEventListener('click', () => showSettingsPanel());

  await refreshStartMenuSlots(startMenu, saveManager, settingsManager);
}

/**
 * 渲染开始菜单里的存档槽位列表（自动存档 + 3 个手动槽位），每一行显示
 * 摘要信息（保存时间/信用点/击杀数）与"读取"/"删除"按钮；空槽位显示
 * "空"，读取按钮禁用。
 * @param {{root:HTMLElement, slotList:HTMLElement}} startMenu
 * @param {SaveManager} saveManager
 * @param {SettingsManager} settingsManager
 */
async function refreshStartMenuSlots(startMenu, saveManager, settingsManager) {
  const allSlotIds = [AUTOSAVE_SLOT_ID, ...MANUAL_SAVE_SLOT_IDS];
  const records = await Promise.all(
    allSlotIds.map((id) => saveManager.readSlot(id).catch(() => undefined))
  );

  startMenu.slotList.innerHTML = '';
  allSlotIds.forEach((slotId, idx) => {
    const record = records[idx];

    const row = document.createElement('div');
    row.className = 'start-menu__slot-row';

    const label = document.createElement('span');
    label.className = 'start-menu__slot-label';
    label.textContent =
      slotId === AUTOSAVE_SLOT_ID ? '自动存档' : `存档槽 ${MANUAL_SAVE_SLOT_IDS.indexOf(slotId) + 1}`;
    row.appendChild(label);

    const summary = document.createElement('span');
    summary.className = 'start-menu__slot-summary';
    let recordIsValid = false;
    if (record) {
      const { valid } = validate(record);
      recordIsValid = valid;
      summary.textContent = valid
        ? `${new Date(record.savedAt).toLocaleString()} · ${record.player.credits}信用点 · 击杀${record.killCount || 0}`
        : '存档已损坏';
    } else {
      summary.textContent = '空';
    }
    row.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'start-menu__slot-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'shop-panel__action-btn';
    loadBtn.textContent = '读取';
    loadBtn.disabled = !recordIsValid;
    loadBtn.addEventListener('click', () => {
      const migrated = migrate(record);
      startMenu.root.classList.remove('visible');
      startGame({ seed: migrated.galaxySeed, saveData: migrated, settingsManager, saveManager });
    });
    actions.appendChild(loadBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shop-panel__action-btn shop-panel__action-btn--danger';
    deleteBtn.textContent = '删除';
    deleteBtn.disabled = !record;
    deleteBtn.addEventListener('click', async () => {
      await saveManager.deleteSlot(slotId);
      refreshStartMenuSlots(startMenu, saveManager, settingsManager);
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    startMenu.slotList.appendChild(row);
  });
}

/**
 * 设置面板的 DOM 绑定与初始值填充。开始菜单和暂停菜单共用同一个面板
 * DOM 实例，这个函数只需要在 initApp() 里调用一次。
 * @param {SettingsManager} settingsManager
 */
function setupSettingsPanel(settingsManager) {
  const panel = {
    closeBtn: document.getElementById('settings-close-btn'),
    invertPitch: document.getElementById('settings-invert-pitch'),
    hudOpacity: document.getElementById('settings-hud-opacity'),
    graphicsQuality: document.getElementById('settings-graphics-quality'),
    showMinimap: document.getElementById('settings-show-minimap'),
    autosaveEnabled: document.getElementById('settings-autosave-enabled'),
  };

  panel.invertPitch.checked = settingsManager.values.invertPitch;
  panel.hudOpacity.value = String(settingsManager.values.hudOpacity);
  panel.graphicsQuality.value = settingsManager.values.graphicsQuality;
  panel.showMinimap.checked = settingsManager.values.showMinimap;
  panel.autosaveEnabled.checked = settingsManager.values.autosaveEnabled;

  panel.closeBtn.addEventListener('click', () => hideSettingsPanel());

  panel.invertPitch.addEventListener('change', (e) => {
    settingsManager.set('invertPitch', e.target.checked);
    activeGameHooks?.setInvertPitch(e.target.checked);
  });
  panel.hudOpacity.addEventListener('input', (e) => {
    const value = Number(e.target.value);
    settingsManager.set('hudOpacity', value);
    activeGameHooks?.setHudOpacity(value);
  });
  panel.graphicsQuality.addEventListener('change', (e) => {
    // 图形质量需要重建渲染管线/星空点云，故意不做"实时应用"，
    // 下次开始游戏（新游戏或读档）时才会生效，面板上有文案说明
    settingsManager.set('graphicsQuality', e.target.value);
  });
  panel.showMinimap.addEventListener('change', (e) => {
    settingsManager.set('showMinimap', e.target.checked);
    activeGameHooks?.setMinimapEnabled(e.target.checked);
  });
  panel.autosaveEnabled.addEventListener('change', (e) => {
    settingsManager.set('autosaveEnabled', e.target.checked);
  });
}

function showSettingsPanel() {
  document.getElementById('settings-panel').classList.add('visible');
}

function hideSettingsPanel() {
  document.getElementById('settings-panel').classList.remove('visible');
}
