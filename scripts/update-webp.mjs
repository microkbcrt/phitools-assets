/**
 * 素材仓库自动化脚本（在 GitHub Actions 里运行）
 *
 * 逻辑：
 *   1) 读取上游 phi-plugin-ill 的文件清单（GitHub API）
 *   2) 与本地已有 ill512/ill2048 比对，找出「新增 / 大小变化」的曲目
 *   3) 从上游下载这些 PNG（GitHub → GitHub，走内网很快）
 *   4) 用 sharp 转出 512w 与 2048w 两套 WebP，写入 ill512/ ill2048/
 *   5) 更新 manifest.json
 *
 * 本地也能跑（用于首次全量生成）：
 *   node scripts/update-webp.mjs            # 只处理缺失/变化的
 *   node scripts/update-webp.mjs --limit 3  # 只处理前 3 首（用于测试）
 *   node scripts/update-webp.mjs --force    # 全部重转
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const UPSTREAM_REPO = 'Catrong/phi-plugin-ill';
const UPSTREAM_BRANCH = 'main';
const OUT_DIR = 'ill-webp';
const SETS = [
    { dir: `${OUT_DIR}/ill512`, width: 512, quality: 80 },
    { dir: `${OUT_DIR}/ill2048`, width: 2048, quality: 80 },
];
const CONCURRENCY = Number(process.env.WEBP_CONCURRENCY || 6);
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) : 0; })();

const TOKEN = process.env.GITHUB_TOKEN || '';
const headers = {
    'User-Agent': 'PhiTools-Assets-Updater',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function upstreamSongs() {
    const url = `https://api.github.com/repos/${UPSTREAM_REPO}/git/trees/${UPSTREAM_BRANCH}?recursive=1`;
    const res = await fetch(url, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`上游清单获取失败: HTTP ${res.status}`);
    const tree = (await res.json()).tree || [];
    return tree
        .filter((e) => e.type === 'blob' && /^ill\/[^/]+\.png$/.test(e.path))
        .map((e) => ({ id: e.path.slice(4, -4), size: e.size }));
}

/** 上游原图地址：优先直连（在 GitHub Actions 里很快），不通则走加速源（本地/国内环境） */
function upstreamUrls(id) {
    const p = `ill/${encodeURIComponent(id)}.png`;
    const raw = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}/${p}`;
    return [
        raw,
        `https://gh.jjj.gv.uy/${raw}`,
        `https://cdn.jsdelivr.net/gh/${UPSTREAM_REPO}@${UPSTREAM_BRANCH}/${p}`,
    ];
}

async function downloadUpstream(id) {
    let lastErr = '无可用来源';
    for (const url of upstreamUrls(id)) {
        try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
            if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 1024) return buf;
            lastErr = '内容过短';
        } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr);
}

async function transcode(id) {
    const buf = await downloadUpstream(id);
    let bytes = 0;
    for (const s of SETS) {
        await fsp.mkdir(s.dir, { recursive: true });
        const out = await sharp(buf)
            .resize({ width: s.width, withoutEnlargement: true })
            .webp({ quality: s.quality, smartSubsample: true })
            .toBuffer();
        await fsp.writeFile(path.join(s.dir, `${id}.webp`), out);
        bytes += out.length;
    }
    return bytes;
}

async function main() {
    const songs = await upstreamSongs();
    console.log(`[upd] 上游共 ${songs.length} 首`);

    const todo = [];
    for (const s of songs) {
        if (FORCE) { todo.push(s); continue; }
        const missing = SETS.some((set) => {
            try { return fs.statSync(path.join(set.dir, `${s.id}.webp`)).size < 512; } catch { return true; }
        });
        if (missing) todo.push(s);
    }
    const list = LIMIT ? todo.slice(0, LIMIT) : todo;
    console.log(`[upd] 待处理 ${list.length} 首${LIMIT ? `（--limit ${LIMIT}）` : ''}`);

    let done = 0, failed = [], totalBytes = 0;
    const queue = list.slice();
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, async () => {
        while (queue.length) {
            const s = queue.shift();
            try {
                totalBytes += await transcode(s.id);
                done++;
                if (done % 25 === 0) console.log(`[upd] ${done}/${list.length} ...`);
            } catch (e) {
                failed.push(s.id);
                console.error(`  [失败] ${s.id}: ${e.message}`);
            }
        }
    }));

    // 统计与清单
    const stat = {};
    for (const set of SETS) {
        let n = 0, b = 0;
        try {
            for (const f of await fsp.readdir(set.dir)) { n++; b += (await fsp.stat(path.join(set.dir, f))).size; }
        } catch (e) { /* 目录不存在 */ }
        stat[set.dir] = { count: n, bytes: b };
    }
    await fsp.mkdir(OUT_DIR, { recursive: true });
    await fsp.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
        updatedAt: new Date().toISOString(),
        upstream: `${UPSTREAM_REPO}@${UPSTREAM_BRANCH}`,
        sets: stat,
    }, null, 2));

    console.log(`[upd] 完成：新增/更新 ${done} 首，失败 ${failed.length} 首，本次写入 ${(totalBytes / 1048576).toFixed(1)} MB`);
    console.log(`[upd] ill512: ${stat[`${OUT_DIR}/ill512`].count} 张 ${(stat[`${OUT_DIR}/ill512`].bytes / 1048576).toFixed(1)} MB`);
    console.log(`[upd] ill2048: ${stat[`${OUT_DIR}/ill2048`].count} 张 ${(stat[`${OUT_DIR}/ill2048`].bytes / 1048576).toFixed(1)} MB`);
    if (failed.length) console.log(`[upd] ⚠ 失败清单：${failed.join(', ')}`);
}

main().catch((e) => { console.error('[upd] 失败:', e.message); process.exit(1); });
