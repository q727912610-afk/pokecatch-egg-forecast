// ==UserScript==
// @name         PokéCatch 孵蛋闪光预测
// @namespace    local.pokecatch.egg-forecast
// @version      1.2.5
// @description  孵蛋预测、游走重开与地下通道收获预览
// @match        https://pokecatch-online.app/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/q727912610-afk/pokecatch-egg-forecast/refs/heads/main/pokecatch-egg-forecast.user.js
// @updateURL    https://raw.githubusercontent.com/q727912610-afk/pokecatch-egg-forecast/refs/heads/main/pokecatch-egg-forecast.user.js
// ==/UserScript==

(() => {
    'use strict';

    const SAVE_KEY = 'gachamon-save-v1';
    const VERIFIED_BUILDS = new Map([
        ['f1ef0dd44e', 1], ['afec80c6e0', 1],
        ['f3a9382a50', 4], ['e2eb68ec8c', 4], ['f467030697', 4],
        ['0696234a19', 4], ['f87e394696', 4],
        ['ed6f25e306', 4], ['b2ce9ed48e', 4], ['8e590d99d0', 4], ['6e904dfeb4', 4], ['a736e7726c', 4], ['79f563cd7e', 4],
    ]);
    const APP_BUNDLE = /^https:\/\/pokecatch-online\.pages\.dev\/bundle\/app\.([a-f0-9]{10})\.js(?:[?#].*)?$/;
    const DITTO = 132;
    const RANGES = [
        [1, 649], [20101, 20127], [35101, 35103], [38601, 38603],
        [41201, 41202], [41301, 41302], [42201, 42201], [42301, 42301],
        [47901, 47905], [48701, 48701], [49201, 49201], [49301, 49316],
        [58501, 58503], [58601, 58603], [64101, 64101], [64201, 64201],
        [64501, 64501], [64601, 64602], [64801, 64801], [64901, 64904], [90025, 90025],
    ];
    // Species for which the verified native canLay({id}) returns false.
    const NO_EGGS = new Set([
        132, 137, 144, 145, 146, 150, 151, 233, 243, 244, 245, 249, 250, 251,
        377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 442, 474, 479,
        480, 481, 482, 483, 484, 485, 486, 487, 488, 491, 492, 493, 494, 556,
        638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
        38601, 38602, 38603, 47901, 47902, 47903, 47904, 47905, 48701,
        49201, 49301, 49302, 49303, 49304, 49305, 49306, 49307, 49308, 49309,
        49310, 49311, 49312, 49313, 49314, 49315, 49316, 64101, 64201,
        64501, 64601, 64602, 64801, 64901, 64902, 64903, 64904, 90025,
    ]);
    const SCAN_OPTIONS = [100, 500, 2000, 10000];
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isCounter = value => Number.isSafeInteger(value) && value >= 0;
    const validFlag = value => value === undefined || [true, false, 1, 0].includes(value);
    const isSeedPart = value => (typeof value === 'string' && value.trim() !== '') || Number.isFinite(value);

    function parentSlots(pension) {
        if (!Array.isArray(pension.mons)) throw Error('找不到寄养亲本列表。');
        return pension.mons.map((entry, index) => {
            const mon = entry?.mon;
            if (!Number.isSafeInteger(mon?.id) || !RANGES.some(([min, max]) => mon.id >= min && mon.id <= max)) {
                throw Error(`槽位 ${index + 1} 的物种编号无法识别。`);
            }
            if (!validFlag(mon.shiny) || !validFlag(mon.noEgg)) {
                throw Error(`槽位 ${index + 1} 的亲本标记无法识别。`);
            }
            return {slot: index + 1, id: mon.id, shiny: Boolean(mon.shiny),
                eligible: !mon.noEgg && !NO_EGGS.has(mon.id)};
        });
    }

    function inspectSave(raw) {
        if (raw === null) throw Error('找不到本机游戏存档。请先进入游戏，等游戏保存一次再试。');
        let save;
        try {
            save = JSON.parse(raw);
        } catch {
            throw Error('本机游戏存档不是可识别的 JSON。');
        }
        if (!isObject(save)) throw Error('本机游戏存档格式无法识别。');
        if (save.fmt !== undefined && (save.fmt !== 2 || !Array.isArray(save.mz?.m))) {
            throw Error('当前存档格式尚未核对。');
        }
        const pension = save.pension;
        if (!isObject(pension)) throw Error('存档没有培育屋数据。');
        const eggs = Array.isArray(pension.eggs) ? pension.eggs : null;
        const queued = validFlag(pension.bx) ? Number(pension.bx ?? 0) : pension.bx;
        let next = pension.laid;
        let counterSource = '存档的共享蛋号';
        if (next == null && isCounter(save.stats?.hatched) && eggs !== null) {
            next = save.stats.hatched + eggs.length;
            counterSource = '原生初始化：已孵化数 + 孵化器中的蛋数';
        }
        const trainer = save.trainer;
        const seed = isSeedPart(trainer?.since) && isSeedPart(trainer?.id) ?
            `${trainer.since}:${trainer.id}` : null;
        return {
            slots: parentSlots(pension),
            next: isCounter(next) ? next : null, counterSource,
            pendingBerries: isCounter(queued) ? queued : null, eggs,
            berryStock: isCounter(save.items?.['belue-berry']) ? save.items['belue-berry'] : null,
            seed,
        };
    }

    // Verified against the public game's native egg rolls; no live game functions are called.
    function hashRoll(key) {
        let low = 1779033703 ^ ((24348 << 16) | 41597);
        let high = 3144134277 ^ ((15337 << 16) | 49222);
        for (let index = 0; index < key.length; index++) {
            const unit = key.charCodeAt(index);
            low = Math.imul(low ^ unit, 2654435761);
            high = Math.imul(high ^ unit, 1597334677);
        }
        low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
        high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
        return (4294967296 * (high & 2097151) + (low >>> 0)) / 9007199254740992;
    }

    function roll(seed, number, draw) {
        return hashRoll(`${seed}|egg|${number}|${draw}`);
    }

    function eggRate(parentStrength, berry) {
        let baseRate = 1 / 512;
        if (parentStrength) baseRate = Number(parentStrength) === 2 ? 1 / 16 : 1 / 10;
        return baseRate * (berry ? 2 : 1);
    }

    function incubatingShiny(egg, seed, build) {
        if (!isObject(egg)) return null;
        if (Object.hasOwn(egg, 'shiny')) {
            return egg.shiny !== undefined && validFlag(egg.shiny) ? Boolean(egg.shiny) : null;
        }
        if (!build || !validFlag(egg.bx)) return null;
        if (!validFlag(egg.sp) && ![2, '1', '2'].includes(egg.sp)) return null;
        const rate = eggRate(egg.sp, egg.bx);
        if (egg.k != null) {
            if (!isCounter(egg.k) || seed === null) return null;
            return roll(seed, egg.k, 0) < rate;
        }
        const legacyKey = egg.uid ?? egg.laidAt;
        return isSeedPart(legacyKey) ? hashRoll(String(legacyKey)) < rate : null;
    }

    function predict(snapshot, limit, maxQueuedBerries) {
        const layers = snapshot.slots.filter(parent => parent.eligible);
        if (!snapshot.slots.some(parent => parent.id === DITTO)) {
            return {reason: '当前没有寄养百变怪，无法自然产蛋。'};
        }
        if (layers.length === 0) return {reason: '当前没有可产蛋的非百变怪亲本。'};
        if (snapshot.next === null) return {reason: '共享蛋号缺失或无效。'};
        if (snapshot.seed === null) return {reason: '缺少完整的训练家种子。'};
        if (snapshot.pendingBerries === null || snapshot.pendingBerries > maxQueuedBerries) {
            return {reason: '待用靛莓果数量无法识别。'};
        }
        if (snapshot.next > Number.MAX_SAFE_INTEGER - (limit - 1)) return {reason: '预测范围超出安全蛋号上限。'};

        const natural = [];
        const onlyWithBerry = [];
        let nextEgg;
        let nextCurrentShiny;
        for (let offset = 0; offset < limit; offset++) {
            const number = snapshot.next + offset;
            const parent = layers[Math.floor(roll(snapshot.seed, number, 1) * layers.length)];
            const value = roll(snapshot.seed, number, 0);
            const rate = eggRate(parent.shiny ? 2 : 0, false);
            const egg = {number, position: offset + 1, parent, natural: value < rate, withBerry: value < 2 * rate};
            if (offset === 0) nextEgg = egg;
            if (egg.natural) natural.push(egg);
            else if (egg.withBerry) onlyWithBerry.push(egg);
            if (!nextCurrentShiny && (offset < snapshot.pendingBerries ? egg.withBerry : egg.natural)) {
                nextCurrentShiny = egg;
            }
        }
        return {natural, onlyWithBerry, nextEgg, nextCurrentShiny};
    }

    function element(tag, value, className) {
        const node = document.createElement(tag);
        if (value !== undefined) node.textContent = value;
        if (className) node.className = className;
        return node;
    }

    function field(container, label, value) {
        const row = element('p');
        row.append(element('strong', label), value);
        container.append(row);
    }

    function position(egg) {
        return `第 ${egg.position} 枚（#${egg.number}）`;
    }

    function showSeries(container, label, hits) {
        const group = element('details');
        const first = hits.length ? ` · 最早第 ${hits[0].position} 枚` : '';
        group.append(element('summary', `${label} · ${hits.length} 枚${first}`));
        group.append(element('p', hits.length ? hits.map(position).join('、') : '本次范围内没有命中。', 'series'));
        container.append(group);
    }

    function describeParent(parent) {
        const species = parent.id === DITTO ? '百变怪 #132' : `#${parent.id}`;
        const status = parent.id === DITTO ? '配对' : parent.eligible ? '可产蛋' : '不产蛋';
        return `槽 ${parent.slot} ${species}${parent.shiny ? ' ✦' : ''}（${status}）`;
    }

    function gameBuild() {
        const builds = new Set();
        for (const script of document.scripts) {
            const match = APP_BUNDLE.exec(script.src);
            if (match) builds.add(match[1]);
        }
        if (builds.size === 0) return {problem: '没有找到游戏程序。请等游戏加载完成后再试。'};
        const [build] = builds;
        if (builds.size > 1 || !VERIFIED_BUILDS.has(build)) {
            return {build: builds.size === 1 ? build : null, problem: `游戏构建尚未核对（${[...builds].join('、')}）。请更新脚本。`};
        }
        return {build, maxQueuedBerries: VERIFIED_BUILDS.get(build)};
    }

    function incubatingList(eggs, seed, build) {
        if (eggs === null) return '存档中没有孵化器列表';
        if (eggs.length === 0) return '孵化器内没有蛋';
        const list = element('span', undefined, 'egg-list');
        eggs.forEach((egg, index) => {
            const number = isCounter(egg?.k) ? `#${egg.k}` : `第 ${index + 1} 枚（无编号）`;
            const shiny = incubatingShiny(egg, seed, build);
            const badge = shiny === true ? '✦ 闪光' : shiny === false ? '普通' : '待确认';
            const item = element('span', undefined, 'egg-item');
            item.append(number, ' ', element('span', badge, shiny ? 'egg-shiny' : 'muted'));
            list.append(item);
        });
        return list;
    }

    function renderSnapshot(output, snapshot, build) {
        const number = snapshot.next === null ? '未知' : `#${snapshot.next}（${snapshot.counterSource}）`;
        field(output, '下一枚共享蛋号　', number);
        field(output, '正在孵化的蛋　', incubatingList(snapshot.eggs, snapshot.seed, build));
        field(output, '当前寄养　', snapshot.slots.map(describeParent).join('；') || '空');
        const stock = snapshot.berryStock === null ? '' : ` · 背包记录 ${snapshot.berryStock} 枚`;
        const queued = snapshot.pendingBerries === null ? '未知' : snapshot.pendingBerries ?
            `${snapshot.pendingBerries} 枚，每颗新产的自然蛋消耗 1 枚` : '无';
        field(output, '待用靛莓果　', queued + stock);
    }

    function renderForecast(output, snapshot, forecast, limit) {
        if (forecast.reason) {
            output.append(element('p', `无法确认：${forecast.reason}`, 'notice'));
            return;
        }
        const {nextEgg, natural, onlyWithBerry, nextCurrentShiny} = forecast;
        const naturalResult = nextEgg.natural ? '闪光' : '普通';
        const berryResult = nextEgg.withBerry ? '闪光' : '普通';
        field(output, '下一枚 · 不用果　', naturalResult);
        field(output, '下一枚 · 用靛莓果　', berryResult);
        field(output, '下一枚 · 按当前待用果状态　', snapshot.pendingBerries ? berryResult : naturalResult);
        field(output, '预计抽中亲本　', describeParent(nextEgg.parent));
        field(output, '距下一闪 · 按当前状态　', nextCurrentShiny ?
            `再产 ${nextCurrentShiny.position} 枚（#${nextCurrentShiny.number}）` : `未来 ${limit} 枚内未找到`);
        showSeries(output, '不用果也闪', natural);
        showSeries(output, '仅该枚用果才闪', onlyWithBerry);
        output.append(element('p',
            '两列都以当前亲本和槽位顺序为条件。一颗靛莓果只加成一枚自然蛋；赠蛋会占用蛋号。更换亲本、产蛋或领赠蛋后，请再点一次预测。',
            'muted'));
    }

    function mountRoamer(controls) {
        controls.append(element('p', '等待战斗界面加载…', 'muted'));
        const BUTTON_ID = 'pokecatch-roamer-restart';
        const ESCAPE_MESSAGES = {
            'zh-Hans': ['糟糕！{mon}挣脱了！它还在附近徘徊……'],
            'zh-Hant': ['糟糕！{mon}掙脫了！它還在附近徘徊……'],
            en: ["Oh no! {mon} broke free! It's still roaming around here…"],
            fr: ["Oh non ! {mon} s'est libéré ! Il rôde encore dans le coin…"],
            es: ['¡Oh, no! ¡{mon} se ha liberado! Sigue merodeando por aquí…'],
            de: ['Oh nein! {mon} hat sich befreit! Es streift noch hier herum…'],
            ja: ['ああっ！ {mon}がボールから出てしまった！ まだこのあたりを徘徊している…'],
            ko: [
                '이런! {mon}이 볼에서 나왔다! 아직 이 근처를 배회하고 있어…',
                '이런! {mon}가 볼에서 나왔다! 아직 이 근처를 배회하고 있어…',
            ],
        };

        const CAPTURE_MESSAGES = {
            'zh-Hans': ['好耶！收服了{mon}！'],
            'zh-Hant': ['好耶！收服了{mon}！'],
            en: ['Gotcha! {mon} was caught!'],
            fr: ['Gotcha ! {mon} est capturé !'],
            es: ['¡Ya está! ¡{mon} ha sido capturado!'],
            de: ['Toll! {mon} wurde gefangen!'],
            ja: ['やったー！ {mon}を捕まえたぞ！'],
            ko: ['신난다! {mon}을 잡았다!', '신난다! {mon}를 잡았다!'],
        };

        const MAP_LABELS = {
            'zh-Hans': ['{mon}在这里徘徊'],
            'zh-Hant': ['{mon}在這裡徘徊'],
            en: ['{mon} is roaming here'],
            fr: ['{mon} rôde ici'],
            es: ['{mon} merodea por aquí'],
            de: ['{mon} streift hier umher'],
            ja: ['{mon}がこのあたりを徘徊している'],
            ko: ['{mon}이 이 근처를 배회하고 있어', '{mon}가 이 근처를 배회하고 있어'],
        };

        function normalize(text) {
            return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
        }

        function isVisible(button) {
            return Boolean(button && !button.disabled && button.getClientRects().length
                && getComputedStyle(button).visibility === 'visible');
        }

        function matchesMessage(templates, name, message) {
            const variants = templates[document.documentElement.lang] ?? templates.en;
            return variants.some(template => normalize(template.replace('{mon}', () => name)) === message);
        }

        function spriteSpecies(image) {
            const src = image?.getAttribute('src') ?? '';
            const match = /(?:^|\/)assets\/pokemon\/(?:(?:art|anim|shiny|still)\/)*(\d+)\.(?:png|gif)(?:[?#].*)?$/i.exec(src);
            return match ? Number(match[1]) : null;
        }

        function battleSpecies(adventure, save) {
            const enemy = adventure.querySelector('#enemy-slot .enemy');
            if (!enemy) return null;
            const species = spriteSpecies(enemy.querySelector('.wrap img'));
            if (species !== null) return species;

            const enemies = save?.adv?.battle?.enemies;
            if (!enemy.dataset.uid || !Array.isArray(enemies)) return null;
            const savedEnemy = enemies.find(mon => mon?.uid === enemy.dataset.uid);
            return Number.isSafeInteger(savedEnemy?.id) ? savedEnemy.id : null;
        }

        function savedRoamerChapter(save, id) {
            const chapter = save?.roam?.at?.[id]?.ch;
            return Number.isSafeInteger(chapter) && chapter >= 0 ? chapter : null;
        }

        function navigateToRoamer(adventure, target, retryIfHere) {
            const mapTrigger = ['chapter-btn', 'side-chapter']
                .map(id => document.getElementById(id)).find(isVisible);
            if (!mapTrigger) return 'unavailable';

            mapTrigger.click();
            const map = document.querySelector('#screen-map.active #map-root');
            const current = map?.querySelector('button.mp-row.current.sel[data-ch]');
            const matches = Array.from(map?.querySelectorAll('button.mp-row.rm-here[data-ch]') ?? [])
                .map(row => ({ row, id: spriteSpecies(row.querySelector('.bd .mp-ev img')) }))
                .filter(({row, id}) => {
                    if (target.id !== null) return id === target.id;
                    // The game can crop a combat sprite into a data URL, losing its filename.
                    const label = row.querySelector('.rm-pill')?.getAttribute('title') ?? '';
                    return id !== null && matchesMessage(MAP_LABELS, target.name, normalize(label));
                });
            const destination = matches.length === 1 ? matches[0].row : null;
            const chapter = destination?.dataset.ch;
            let result = 'unavailable';
            if (current && chapter && /^\d+$/.test(chapter)) {
                target.id = matches[0].id;
                const sameChapter = chapter === current.dataset.ch;
                if (sameChapter && !retryIfHere) {
                    result = 'here';
                } else {
                    const selector = sameChapter
                        ? `.ch-det button.mp-restart[data-restart="${chapter}"]`
                        : `.ch-det button.mp-go[data-go="${chapter}"]`;
                    let action = map.querySelector(selector);
                    if (!isVisible(action) && isVisible(destination)) {
                        // Selecting the row renders its details and opens the mobile drawer.
                        destination.click();
                        action = map.querySelector(selector);
                    }
                    if (isVisible(action)) {
                        action.click();
                        if (adventure.classList.contains('active')) return sameChapter ? 'restarted' : 'moved';
                    }
                }
            }

            if (document.querySelector('#screen-map.active')) {
                document.querySelector('#tabs [data-screen="adventure"]')?.click();
            }
            return result;
        }

        function mount() {
            const adventure = document.getElementById('screen-adventure');
            const log = adventure?.querySelector('#battle-log');
            if (!log) return false;
            if (controls.querySelector('#' + BUTTON_ID)) return true;

            const toggle = document.createElement('button');
            toggle.id = BUTTON_ID;
            toggle.type = 'button';
            toggle.className = 'btn small';
            toggle.style.display = 'inline-grid';
            const toggleLabel = document.createElement('span');
            const missedLabel = document.createElement('small');
            toggle.append(toggleLabel, missedLabel);
            controls.replaceChildren(toggle);

            let enabled = false;
            let target = null;
            let lastLog = normalize(log.textContent);
            let lastSaveText;
            let snapshot = null;
            let missedCount = 0;

            function showToggle(label = '') {
                toggleLabel.textContent = label || `游走重开：${enabled ? '开' : '关'}`;
                missedLabel.textContent = `未捕获 ${missedCount} 次`;
                toggle.setAttribute('aria-pressed', String(enabled));
                toggle.title = '开启时记录游走传说未捕获次数，关闭时清零。点击切换。';
            }

            function readSave() {
                try {
                    const raw = localStorage.getItem(SAVE_KEY);
                    if (raw !== lastSaveText) {
                        lastSaveText = raw;
                        snapshot = raw ? JSON.parse(raw) : null;
                    }
                } catch {
                    snapshot = null;
                }
                return snapshot;
            }

            function finishCapture() {
                const name = target.name;
                target = null;
                showToggle(`已捕捉：${name}`);
            }

            function navigate(retryIfHere) {
                const result = navigateToRoamer(adventure, target, retryIfHere);
                if (result === 'unavailable') {
                    showToggle(`${target.name}：位置待核对`);
                    return;
                }
                const status = result === 'moved' ? '已换章' : result === 'restarted' ? '已重开' : '追踪中';
                showToggle(`${status}：${target.name}`);
            }

            function checkLocation() {
                if (target?.id == null || document.hidden || !adventure.classList.contains('active')) return;

                const save = readSave();
                if (Array.isArray(save?.roam?.caught) && save.roam.caught.includes(target.id)) {
                    finishCapture();
                    return;
                }
                const chapter = savedRoamerChapter(save, target.id);
                if (chapter === null || chapter === target.lastSavedChapter) return;

                const state = save.adv;
                if (!Number.isSafeInteger(state?.chapter) || state.zone || state.league || state.tower || state.event
                    || battleSpecies(adventure, save) === target.id || adventure.querySelector('#enemy-slot .enemy.in-ball')
                    || document.querySelector('#modal-root.open')) return;

                target.lastSavedChapter = chapter;
                if (chapter !== state.chapter) navigate(false);
            }

            toggle.addEventListener('click', () => {
                enabled = !enabled;
                target = null;
                missedCount = 0;
                lastLog = normalize(log.textContent);
                showToggle();
            });
            showToggle();
            setInterval(checkLocation, 1000);

            new MutationObserver(() => {
                const message = normalize(log.textContent);
                if (message === lastLog) return;
                lastLog = message;
                if (!enabled || document.hidden || !adventure.classList.contains('active')) return;

                const name = log.querySelector('b')?.textContent.trim();
                if (!name) return;
                if (target?.name === name && matchesMessage(CAPTURE_MESSAGES, name, message)) {
                    finishCapture();
                    return;
                }
                if (!matchesMessage(ESCAPE_MESSAGES, name, message)) return;

                const save = readSave();
                const id = battleSpecies(adventure, save);
                if (Array.isArray(save?.roam?.caught) && save.roam.caught.includes(id)) return;

                missedCount += 1;
                target = { id, name, lastSavedChapter: savedRoamerChapter(save, id) };
                navigate(true);
                target.lastSavedChapter = savedRoamerChapter(readSave(), target.id);
            }).observe(log, { childList: true, subtree: true, characterData: true });
            return true;
        }

        if (!mount()) {
            const waitForAdventure = new MutationObserver(() => {
                if (mount()) waitForAdventure.disconnect();
            });
            waitForAdventure.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    // Simplified Chinese labels from the game’s Underground tables and language pack.
    const UNDERGROUND_ITEM_NAMES = new Map(Object.entries({
        "rare-candy": "神奇糖果",
        "exp-candy-s": "经验糖果S",
        "exp-candy-m": "经验糖果M",
        "exp-candy-xl": "经验糖果XL",
        "exp-candy-big": "经验糖果特大",
        "fire-stone": "火之石",
        "water-stone": "水之石",
        "thunder-stone": "雷之石",
        "leaf-stone": "叶之石",
        "moon-stone": "月之石",
        "sun-stone": "日之石",
        "shiny-stone": "光之石",
        "dusk-stone": "暗之石",
        "dawn-stone": "觉醒之石",
        "ice-stone": "冰之石",
        "kings-rock": "王者之证",
        "metal-coat": "金属膜",
        "dragon-scale": "龙之鳞片",
        "prism-scale": "美丽鳞片",
        "deep-sea-tooth": "深海之牙",
        "deep-sea-scale": "深海鳞片",
        "oval-stone": "浑圆之石",
        "protector": "护具",
        "electirizer": "电力增幅器",
        "magmarizer": "熔岩增幅器",
        "reaper-cloth": "灵界之布",
        "razor-claw": "锐利之爪",
        "razor-fang": "锐利之牙",
        "razz-berry": "蔓莓果",
        "pinap-berry": "凰梨果",
        "lansat-berry": "兰萨果",
        "golden-razz-berry": "金色蔓莓果",
        "nanab-berry": "蕉香果",
        "enigma-berry": "谜芝果",
        "starf-berry": "星桃果",
    }));

    const UNDERGROUND_ITEM_DESCRIPTIONS = new Map(Object.entries({
        "rare-candy": "让一只宝可梦提升1级。",
        "exp-candy-s": "给一只宝可梦经验值。",
        "exp-candy-m": "给一只宝可梦许多经验值。",
        "exp-candy-xl": "给一只宝可梦大量经验值。",
        "exp-candy-big": "给一只宝可梦堆积如山的经验值。",
        "fire-stone": "用于让特定宝可梦进化。",
        "water-stone": "用于让特定宝可梦进化。",
        "thunder-stone": "用于让特定宝可梦进化。",
        "leaf-stone": "用于让特定宝可梦进化。",
        "moon-stone": "用于让特定宝可梦进化。",
        "sun-stone": "用于让特定宝可梦进化。",
        "shiny-stone": "用于让特定宝可梦进化。",
        "dusk-stone": "用于让特定宝可梦进化。",
        "dawn-stone": "用于让特定宝可梦进化。",
        "ice-stone": "用于让特定宝可梦进化。",
        "kings-rock": "用于让特定宝可梦进化。",
        "metal-coat": "用于让特定宝可梦进化。",
        "dragon-scale": "用于让特定宝可梦进化。",
        "prism-scale": "用于让特定宝可梦进化。",
        "deep-sea-tooth": "用于让特定宝可梦进化。",
        "deep-sea-scale": "用于让特定宝可梦进化。",
        "oval-stone": "用于让特定宝可梦进化。",
        "protector": "用于让特定宝可梦进化。",
        "electirizer": "用于让特定宝可梦进化。",
        "magmarizer": "用于让特定宝可梦进化。",
        "reaper-cloth": "用于让特定宝可梦进化。",
        "razor-claw": "用于让特定宝可梦在夜间进化。",
        "razor-fang": "用于让特定宝可梦在夜间进化。",
        "razz-berry": "提高捕捉几率。",
        "golden-razz-berry": "进一步提高捕捉几率。",
        "pinap-berry": "提高经验收益。",
        "lansat-berry": "提高金币收益。",
        "nanab-berry": "提高稀有宝可梦的出现概率。",
        "enigma-berry": "提高未登记宝可梦的出现概率。",
        "starf-berry": "提高异色宝可梦的出现概率。",
    }));

    const UNDERGROUND_PLATE_NAMES = new Map(Object.entries({
        "fire": "火球石板",
        "water": "水滴石板",
        "grass": "碧绿石板",
        "electric": "雷电石板",
        "ice": "冰柱石板",
        "fighting": "拳头石板",
        "poison": "剧毒石板",
        "ground": "大地石板",
        "flying": "蓝天石板",
        "psychic": "神奇石板",
        "bug": "玉虫石板",
        "rock": "岩石石板",
        "ghost": "妖怪石板",
        "dragon": "龙之石板",
        "dark": "恶颜石板",
        "steel": "钢铁石板",
    }));

    const UNDERGROUND_FOSSIL_NAMES = new Map(Object.entries({
        "138": "菊石兽",
        "140": "化石盔",
        "142": "化石翼龙",
        "345": "触手百合",
        "347": "太古羽虫",
        "408": "头盖龙",
        "410": "盾甲龙",
        "564": "原盖海龟",
        "566": "始祖小鸟",
    }));

    function summarizeUndergroundLoot(floors, count) {
        const totals = new Map();
        const descriptions = new Map();
        const geodeNames = ["普通晶洞","少见晶洞","稀有晶洞","传说晶洞"];
        for (const rewards of floors.slice(0, count)) {
            if (!Array.isArray(rewards)) throw new Error('逐层掉落格式无法识别。');
            for (const reward of rewards) {
                const {k, n, id, t, type} = reward ?? {};
                let label;
                let amount = 1;
                switch (k) {
                    case 'money': label = '金币'; amount = n; break;
                    case 'shards': label = '碎片'; amount = n; break;
                    case 'item':
                        label = UNDERGROUND_ITEM_NAMES.get(id) ?? ('未收录道具 · ' + id);
                        if (UNDERGROUND_ITEM_DESCRIPTIONS.has(id)) {
                            descriptions.set(label, UNDERGROUND_ITEM_DESCRIPTIONS.get(id));
                        }
                        break;
                    case 'geode': label = geodeNames[t]; break;
                    case 'plate':
                        label = (UNDERGROUND_PLATE_NAMES.get(type) ?? ('未收录石板 · ' + type)) + '（档位 ' + t + '）';
                        break;
                    case 'fossil':
                        label = '化石 · ' + (UNDERGROUND_FOSSIL_NAMES.get(String(id)) ?? ('#' + id));
                        break;
                }
                if (!label || !Number.isSafeInteger(amount) || amount < 0) {
                    throw new Error('掉落类型或数量无法识别。');
                }
                totals.set(label, (totals.get(label) ?? 0) + amount);
            }
        }
        return [...totals].filter(([, amount]) => amount).map(([label, amount]) => {
            const description = descriptions.get(label);
            return label + ' × ' + amount + (description ? '（' + description + '）' : '');
        }).join('、') || '无';
    }

    function undergroundProgress(slot, now) {
        const {start, end, from = 1, recalled, res} = slot ?? {};
        const {floors, loot, at} = res ?? {};
        if (![start, end].every(Number.isFinite) || end < start ||
            !Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(floors) || floors < 0 ||
            !Array.isArray(loot) || loot.length < floors || !Array.isArray(at) ||
            at.length < floors || (recalled != null && !Number.isFinite(recalled))) {
            throw new Error('存档缺少可识别的探险结果。');
        }
        const elapsed = ((recalled ?? now) - start) / 2800;
        let completed = 0;
        if (recalled == null && now >= end) completed = floors;
        else for (let i = 0; i < floors && at[i] <= elapsed; i++) completed++;
        return {completed, floors, from, loot, end, recalled};
    }

    function mountUnderground(view) {
        const refresh = element('button', '读取探险存档');
        refresh.type = 'button';
        const output = element('div', undefined, 'output');
        output.setAttribute('role', 'status');
        output.append(element('p', '可预览已出发探险的掉落，并模拟不同楼层召回。出发前队伍模拟尚未加入。', 'muted'));
        view.append(refresh, output);

        function renderSlot(slot, index, now) {
            const group = element('details');
            group.open = true;
            group.append(element('summary', '槽位 ' + ((Number.isSafeInteger(slot?.bay) ? slot.bay : index) + 1)));
            try {
                const {completed, floors, from, loot, end, recalled} = undergroundProgress(slot, now);
                const reaching = completed < from ? '尚未完成起始层' : '第 ' + completed + ' 层';
                const currentLabel = recalled != null ? '已召回 · ' : end <= now ? '已结束 · ' : '';
                field(group, '主题　', String(slot.theme ?? '未知'));
                field(group, '起始楼层　', String(from));
                field(group, '当前进度　', currentLabel + reaching);
                field(group, '预计最终楼层　', String(floors));
                field(group, '预计结束　', new Date(end).toLocaleString());
                field(group, recalled != null ? '召回时的掉落　' : '现在召回的掉落　', summarizeUndergroundLoot(loot, completed));
                field(group, '跑完整趟的原始掉落　', summarizeUndergroundLoot(loot, floors));

                if (floors > from) {
                    const label = element('label', '模拟完成到第几层后召回　');
                    const floor = element('input');
                    floor.type = 'number';
                    floor.min = String(from);
                    floor.max = String(floors);
                    floor.step = '1';
                    floor.value = String(Math.max(from, completed));
                    const result = element('p');
                    function showRecall() {
                        result.textContent = floor.value && floor.validity.valid
                            ? summarizeUndergroundLoot(loot, Number(floor.value))
                            : '请输入 ' + from + ' 至 ' + floors + ' 之间的整数。';
                    }
                    floor.addEventListener('input', showRecall);
                    label.append(floor);
                    group.append(label, result);
                    showRecall();
                }
            } catch (error) {
                group.append(element('p', error.message, 'notice'));
            }
            return group;
        }

        refresh.addEventListener('click', () => {
            output.replaceChildren();
            try {
                const {build, problem} = gameBuild();
                if (!build) throw new Error(problem);
                if (!['ed6f25e306', 'b2ce9ed48e', '8e590d99d0', '6e904dfeb4'].includes(build)) {
                    throw new Error('此游戏构建的地下通道存档尚未核对。');
                }
                const raw = localStorage.getItem(SAVE_KEY);
                if (raw === null) throw new Error('找不到本机游戏存档。');
                const save = JSON.parse(raw);
                const slots = save?.under?.slots;
                if (slots != null && !Array.isArray(slots)) throw new Error('地下通道槽位格式无法识别。');
                const active = slots?.filter(Boolean) ?? [];
                if (active.length === 0) {
                    output.append(element('p', '没有已出发的探险。', 'muted'));
                    return;
                }
                const now = Date.now();
                active.forEach((slot, index) => output.append(renderSlot(slot, index, now)));
                output.append(element('p', '显示存档中的原始掉落。领取时游戏可能转换重复石板，并另行判定化石异色。', 'muted'));
            } catch (error) {
                output.append(element('p', error.message, 'notice'));
            }
        });
    }

    function mount() {
        const host = element('div');
        host.id = 'pc-egg-forecast';
        if (!document.body || document.getElementById(host.id)) return;
        const root = host.attachShadow({mode: 'open'});
        const style = element('style', `
            :host { all: initial; position: fixed; right: 14px; bottom: 14px; z-index: 2147483000;
                color-scheme: dark; }
            .panel { box-sizing: border-box; padding: 12px 13px; border: 1px solid #41605d;
                width: min(420px, calc(100vw - 28px));
                border-radius: 12px; background: #142523; color: #e5f1ee;
                box-shadow: 0 8px 24px #0008; font: 13px/1.55 system-ui, sans-serif; }
            .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
            button, select { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid #539087; }
            button { background: #a9ecce; color: #10251e; font-weight: 650; cursor: pointer; }
            .launcher { padding: 4px 8px; font: 600 12px/1.5 system-ui, sans-serif;
                color: #e5f1ee; background: #142523; }
            [hidden] { display: none !important; }
            .plugin-menu { display: grid; gap: 6px; margin-bottom: 10px; }
            .plugin-menu button { text-align: left; }
            .plugin-menu button[aria-pressed="true"] { outline: 2px solid #a9ecce; outline-offset: 2px; }
            select { color: #e5f1ee; background: #213a36; }
            .output { max-height: min(55vh, 460px); overflow: auto; }
            p { margin: 6px 0; }
            details { margin: 6px 0; }
            summary { cursor: pointer; color: #a9ecce; }
            .muted { color: #b4cbc3; font-size: 12px; }
            .notice { color: #ffcf90; }
            .egg-list { display: flex; flex-wrap: wrap; gap: 4px 7px; margin-top: 3px; }
            .egg-item { border: 1px solid #41605d; border-radius: 5px; padding: 0 4px; }
            .egg-shiny { color: #ffdf88; font-weight: 700; }
            .series { overflow-wrap: anywhere; }
        `);
        const panel = element('section', undefined, 'panel');
        panel.id = 'forecast-panel';
        panel.setAttribute('aria-label', 'pokecatch插件');
        panel.hidden = true;
        const launcher = element('button', 'pokecatch插件', 'launcher');
        launcher.type = 'button';
        launcher.setAttribute('aria-controls', panel.id);
        launcher.setAttribute('aria-expanded', 'false');
        const toolbar = element('div', undefined, 'toolbar');
        const button = element('button', '获取预测');
        button.type = 'button';
        const range = element('select');
        range.setAttribute('aria-label', '预测范围');
        for (const size of SCAN_OPTIONS) {
            const option = element('option', `未来 ${size} 枚`);
            option.value = size;
            range.append(option);
        }
        range.value = '2000';
        toolbar.append(button, range);
        const output = element('div', undefined, 'output');
        output.setAttribute('role', 'status');
        output.append(element('p', '点击后读取本机最近一次游戏存档。', 'muted'));
        const eggView = element('section');
        eggView.append(toolbar, output);
        const roamerView = element('section');
        const undergroundView = element('section');
        const menu = element('nav', undefined, 'plugin-menu');
        menu.setAttribute('aria-label', '插件功能');
        const views = [eggView, roamerView, undergroundView];
        const choices = ['孵蛋预测', '游走重开', '地下通道模拟'].map((label, index) => {
            const choice = element('button', label);
            choice.type = 'button';
            choice.setAttribute('aria-pressed', 'false');
            views[index].hidden = true;
            choice.addEventListener('click', () => {
                views.forEach((view, item) => {
                    view.hidden = item !== index;
                    choices[item].setAttribute('aria-pressed', String(item === index));
                });
            });
            menu.append(choice);
            return choice;
        });
        panel.append(menu, ...views);
        root.append(style, launcher, panel);
        document.body.append(host);
        mountRoamer(roamerView);
        mountUnderground(undergroundView);

        launcher.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            launcher.setAttribute('aria-expanded', String(!panel.hidden));
        });

        button.addEventListener('click', () => {
            button.disabled = true;
            const status = element('div');
            try {
                const snapshot = inspectSave(localStorage.getItem(SAVE_KEY));
                const {build, problem, maxQueuedBerries} = gameBuild();
                renderSnapshot(status, snapshot, problem ? null : build);
                if (problem) throw Error(problem);
                const limit = Number(range.value);
                if (!SCAN_OPTIONS.includes(limit)) throw Error('预测范围无法识别。');
                renderForecast(status, snapshot, predict(snapshot, limit, maxQueuedBerries), limit);
                status.append(element('p', `依据：本机游戏存档 · 原生蛋序号与随机规则 · 构建 ${build}`, 'muted'));
            } catch (error) {
                const message = error?.name === 'SecurityError' ? '浏览器禁止访问本机存档。' :
                    (error?.message || '本地数据无法读取。');
                status.append(element('p', `无法确认：${message}`, 'notice'));
            } finally {
                status.append(element('p', `读取于 ${new Date().toLocaleTimeString()} · 结果不会自动更新`, 'muted'));
                output.replaceChildren(status);
                output.scrollTop = 0;
                button.disabled = false;
            }
        });
    }

    mount();
})();
