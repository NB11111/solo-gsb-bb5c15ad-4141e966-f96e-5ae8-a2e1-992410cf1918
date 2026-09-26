/**
 * 跨平台迁移检查接口测试（HTTP 级）：
 * - 两种方向均可返回报告，演示种子下各有迁移新增的 duplicate / prefix 冲突；
 * - 每条新增冲突列出原序列、迁移序列、冲突双方与受影响叶子；
 * - 同一冲突跨叶子合并为一条；
 * - 非法方向返回 400；检查为纯只读：多次调用后状态指纹不变。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcut-migration-test-'));
process.env.DATA_DIR = DATA_DIR;

const { start } = require('../src/index');

let server;
let base;
let passed = 0;

const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const req = async (method, url) => {
  const res = await fetch(base + url, { method });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const stateFingerprint = (s) => {
  const ctx = s.contexts.map((c) => ({ id: c.id, parentId: c.parentId ?? null, name: c.name, description: c.description || '' }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const cmds = s.commands.map((c) => ({ id: c.id, contextId: c.contextId, name: c.name, sequenceTokens: c.sequenceTokens, sequenceLabel: c.sequenceLabel }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return createHash('sha256').update(JSON.stringify({ contexts: ctx, commands: cmds })).digest('hex');
};

async function main() {
  ({ server } = await start(0));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const direction of ['ctrl-to-meta', 'meta-to-ctrl']) {
    await test(`GET /api/migration-report/${direction} 返回迁移新增冲突（含原序列/迁移序列/双方/叶子）`, async () => {
      const { status, data } = await req('GET', `/api/migration-report/${direction}`);
      assert.equal(status, 200);
      assert.equal(data.format, 'shortcut-migration-report-v1');
      assert.equal(data.direction, direction);
      assert.equal(data.readOnly, true);
      assert.ok(data.stats.leafCount >= 2);
      assert.ok(data.stats.duplicateCount >= 1);
      assert.ok(data.stats.prefixCount >= 1);
      assert.equal(data.stats.conflictCount, data.conflicts.length);

      const dup = data.conflicts.find((c) => c.type === 'duplicate');
      assert.ok(dup.affectedLeaves.length >= 2, '同层重复应跨全部叶子合并为一条');
      assert.ok(dup.originalSequenceLabels.length >= 2, '应列出双方各自的原序列');
      assert.ok(dup.parties.every((p) => p.fromSequenceLabel && p.toSequenceLabel));

      const pre = data.conflicts.find((c) => c.type === 'prefix');
      assert.ok(pre.prefixTokens && pre.extensionTokens);
      assert.ok(pre.parties.some((p) => p.role === 'prefix'));
      assert.ok(pre.parties.some((p) => p.role === 'extension'));
      assert.ok(pre.affectedLeaves.every((l) => l.contextId && l.contextPath));
    });
  }

  await test('同一冲突跨叶子出现时合并为一条（affectedLeafCount = 受影响叶子数）', async () => {
    const { data } = await req('GET', '/api/migration-report/ctrl-to-meta');
    for (const c of data.conflicts) {
      assert.equal(c.affectedLeaves.length, c.affectedLeafCount);
      assert.equal(new Set(c.affectedLeaves.map((l) => l.contextId)).size, c.affectedLeaves.length);
    }
  });

  await test('非法迁移方向返回 400', async () => {
    const { status, data } = await req('GET', '/api/migration-report/alt-to-meta');
    assert.equal(status, 400);
    assert.match(data.error, /迁移方向/);
  });

  await test('download=1 返回附件响应头', async () => {
    const res = await fetch(base + '/api/migration-report/ctrl-to-meta?download=1');
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
    await res.json();
  });

  await test('检查过程只读：重复调用后状态文件与命令均未变化', async () => {
    const before = (await req('GET', '/api/state')).data;
    const fpBefore = stateFingerprint(before);
    await req('GET', '/api/migration-report/ctrl-to-meta');
    await req('GET', '/api/migration-report/meta-to-ctrl');
    const after = (await req('GET', '/api/state')).data;
    assert.equal(stateFingerprint(after), fpBefore);
    // 抽查种子命令的序列没有被改写
    const sample = after.commands.find((c) => c.name === '聚焦下一个面板');
    assert.equal(sample.sequenceLabel, 'Ctrl+J');
  });

  console.log(`\n迁移检查接口测试全部通过：${passed} 项`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
