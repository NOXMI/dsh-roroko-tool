/**
 * roroko-tool 子插件参数覆盖持久化:state 文件 IO。
 *
 * 存储:当前 profile 目录下 `roroko-tool-state.json`(与 cordis.patch.yml 同
 * 层),跨重启保留。profile 目录由 `--profile <name>` + DSH_HOME(默认
 * ~/.dsh)推导,仿 dshmarket 的 activeProfileDir 解析。
 *
 * 语义(2026-09-03 三改):enabled 开关已退役,state 只存「参数覆盖层」——
 * 子插件存在与否由 agent preset 声明决定,参数由 state 覆盖优先 + preset
 * config 兜底。本文件仍提供 loadState/loadStateSync(子插件读取覆盖)与
 * setPreinjectConfig/setDataConfig(设置页写覆盖)。
 *
 * 读写全部原子化(写先落临时文件再 rename),避免并发/中断写坏文件。
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises';
import { normalizeDataState, normalizeMarkState, normalizePreinjectState, normalizeState, RorokoToolStateDefault, } from './settings.js';
/** 当前运行的 profile 名(默认 web)。 */
function runningProfile() {
    const argv = process.argv;
    const flag = argv.indexOf('--profile');
    if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) {
        return argv[flag + 1];
    }
    return 'web';
}
/** state 文件绝对路径。 */
export function rorokoToolStatePath() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(home, 'profiles', runningProfile(), 'roroko-tool-state.json');
}
/** 读 state;文件缺失/损坏时回落到默认(不抛)。 */
export async function loadState() {
    const file = rorokoToolStatePath();
    try {
        const raw = await readFile(file, 'utf8');
        return normalizeState(JSON.parse(raw));
    }
    catch {
        return structuredClone(RorokoToolStateDefault);
    }
}
/**
 * 同步读 state(agent preset 层插件 apply 阶段用,不能 await 时)。
 * 文件缺失/损坏时回落到默认(不抛)。
 */
export function loadStateSync() {
    const file = rorokoToolStatePath();
    try {
        const raw = readFileSync(file, 'utf8');
        return normalizeState(JSON.parse(raw));
    }
    catch {
        return structuredClone(RorokoToolStateDefault);
    }
}
/** 原子写 state(临时文件 + rename)。 */
export async function saveState(state) {
    const file = rorokoToolStatePath();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, file);
}
/**
 * 覆盖保存 preinject 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值(部分保存语义)。落盘后返回新状态。
 */
export async function setPreinjectConfig(config) {
    const current = await loadState();
    const existing = current.preinject;
    const merged = {
        files: Array.isArray(config.files)
            ? config.files.filter((item) => typeof item === 'string')
            : existing.files,
        header: typeof config.header === 'string'
            ? config.header
            : existing.header,
        footer: typeof config.footer === 'string'
            ? config.footer
            : existing.footer,
        wrapInSystemReminder: typeof config.wrapInSystemReminder === 'boolean'
            ? config.wrapInSystemReminder
            : existing.wrapInSystemReminder,
    };
    const next = {
        ...current,
        preinject: normalizePreinjectState(merged),
    };
    await saveState(next);
    return next;
}
/**
 * 覆盖保存 data 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export async function setDataConfig(config) {
    const current = await loadState();
    const existing = current.data;
    const merged = {
        dbPath: typeof config.dbPath === 'string' && config.dbPath.trim().length > 0
            ? config.dbPath.trim()
            : existing.dbPath,
    };
    const next = {
        ...current,
        data: normalizeDataState(merged),
    };
    await saveState(next);
    return next;
}
/**
 * 覆盖保存 mark 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export async function setMarkConfig(config) {
    const current = await loadState();
    const merged = {
        enabled: typeof config.enabled === 'boolean'
            ? config.enabled
            : current.mark.enabled,
    };
    const next = {
        ...current,
        mark: normalizeMarkState(merged),
    };
    await saveState(next);
    return next;
}
