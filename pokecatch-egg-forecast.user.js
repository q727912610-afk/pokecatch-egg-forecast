// ==UserScript==
// @name         PokéCatch 孵蛋闪光预测
// @namespace    local.pokecatch.egg-forecast
// @version      1.1.8
// @description  手动读取本地存档，查看在孵蛋闪光状态及未来产蛋预测
// @match        https://pokecatch-online.app/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/q727912610-afk/pokecatch-egg-forecast/refs/heads/main/pokecatch-egg-forecast.user.js
// @downloadURL  https://raw.githubusercontent.com/q727912610-afk/pokecatch-egg-forecast/refs/heads/main/pokecatch-egg-forecast.user.js
// ==/UserScript==

(() => {
    'use strict';

    const SAVE_KEY = 'gachamon-save-v1';
    const VERIFIED_BUILDS = new Map([
        ['f1ef0dd44e', 1], ['afec80c6e0', 1],
        ['f3a9382a50', 4], ['e2eb68ec8c', 4], ['f467030697', 4],
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
            return {problem: `游戏构建尚未核对（${[...builds].join('、')}）。请更新脚本。`};
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
            .hide { margin-inline-start: auto; color: #e5f1ee; background: #213a36; }
            .launcher { padding: 4px 8px; font: 600 12px/1.5 system-ui, sans-serif;
                color: #e5f1ee; background: #142523; }
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
        panel.setAttribute('aria-label', '孵蛋闪光预测');
        const launcher = element('button', '孵蛋预测', 'launcher');
        launcher.type = 'button';
        launcher.hidden = true;
        launcher.setAttribute('aria-controls', panel.id);
        launcher.setAttribute('aria-expanded', 'false');
        const toolbar = element('div', undefined, 'toolbar');
        const button = element('button', '获取预测');
        button.type = 'button';
        const hide = element('button', '隐藏', 'hide');
        hide.type = 'button';
        const range = element('select');
        range.setAttribute('aria-label', '预测范围');
        for (const size of SCAN_OPTIONS) {
            const option = element('option', `未来 ${size} 枚`);
            option.value = size;
            range.append(option);
        }
        range.value = '2000';
        toolbar.append(button, range, hide);
        const output = element('div', undefined, 'output');
        output.setAttribute('role', 'status');
        output.append(element('p', '点击后读取本机最近一次游戏存档。', 'muted'));
        panel.append(toolbar, output);
        root.append(style, panel, launcher);
        document.body.append(host);

        hide.addEventListener('click', () => {
            panel.hidden = true;
            launcher.hidden = false;
            launcher.focus();
        });
        launcher.addEventListener('click', () => {
            panel.hidden = false;
            launcher.hidden = true;
            hide.focus();
        });

        button.addEventListener('click', () => {
            button.disabled = true;
            const status = element('div');
            try {
                const snapshot = inspectSave(localStorage.getItem(SAVE_KEY));
                const {build, problem, maxQueuedBerries} = gameBuild();
                renderSnapshot(status, snapshot, build);
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
