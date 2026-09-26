import React, { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * 跨平台迁移检查页（只读）：
 * - 提供 Ctrl→Meta 与 Meta→Ctrl 两种方向的只读映射；
 * - 后端对全部叶子上下文分别复用最近祖先生效 / duplicate / prefix 判定，
 *   以命令身份 + 冲突类型比较迁移前后，只报告迁移新增的冲突；
 * - 同一冲突跨叶子出现时合并展示叶子列表；
 * - 支持按冲突类型筛选；检查过程不修改命令或持久化数据。
 */

const DIRECTIONS = [
  { key: 'ctrl-to-meta', label: 'Ctrl → Meta', hint: 'Windows/Linux 快捷键迁移到 macOS（Command）' },
  { key: 'meta-to-ctrl', label: 'Meta → Ctrl', hint: 'macOS（Command）快捷键迁移到 Windows/Linux' },
];

const TYPE_META = {
  duplicate: { label: '同层重复', cls: 'dup' },
  prefix: { label: '前缀冲突', cls: 'pre' },
};

function StatCard({ value, label, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function PartyList({ conflict, role }) {
  const parties = role ? conflict.parties.filter((p) => p.role === role) : conflict.parties;
  return (
    <ul className="migration-parties">
      {parties.map((p) => (
        <li key={p.commandId}>
          <span className="party-name">{p.name}</span>
          <span className="migration-seq-pair">
            <kbd className="seq dim" title="迁移前序列">
              {p.fromSequenceLabel}
            </kbd>
            <span className="migration-arrow">→</span>
            <kbd className="seq" title="迁移后序列">
              {p.toSequenceLabel}
            </kbd>
          </span>
          <span className="party-source">来源：{p.contextPath}</span>
        </li>
      ))}
    </ul>
  );
}

function ConflictRecord({ conflict }) {
  const meta = TYPE_META[conflict.type];
  return (
    <div className={`migration-card ${conflict.type}`}>
      <div className="migration-card-head">
        <span className={`conflict-chip ${meta.cls}`}>⛔ {meta.label}</span>
        {conflict.type === 'prefix' ? (
          <span className="conflict-seqs">
            <kbd>{conflict.prefixSequenceLabel}</kbd>
            <em className="dim"> ⊂ </em>
            <kbd>{conflict.extensionSequenceLabel}</kbd>
          </span>
        ) : (
          <span className="conflict-seqs">
            <kbd>{conflict.sequenceLabel}</kbd>
          </span>
        )}
        <span className="badge active">{conflict.affectedLeafCount} 个叶子</span>
      </div>

      {conflict.type === 'prefix' ? (
        <div className="migration-groups">
          <div className="migration-group">
            <span className="role-tag">前缀方</span>
            <PartyList conflict={conflict} role="prefix" />
          </div>
          <div className="migration-group">
            <span className="role-tag extension">延伸方</span>
            <PartyList conflict={conflict} role="extension" />
          </div>
        </div>
      ) : (
        <PartyList conflict={conflict} />
      )}

      <div className="migration-leaves">
        <span className="migration-leaves-label">受影响叶子上下文：</span>
        {conflict.affectedLeaves.map((leaf) => (
          <span key={leaf.contextId} className="migration-leaf-tag" title={leaf.contextPath}>
            {leaf.contextPath}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MigrationReport() {
  const [direction, setDirection] = useState('ctrl-to-meta');
  const [typeFilter, setTypeFilter] = useState('all'); // all | duplicate | prefix
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showJson, setShowJson] = useState(false);

  const load = async (dir = direction) => {
    setLoading(true);
    try {
      setData(await api.migrationReport(dir));
      setError('');
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  const currentDirection = DIRECTIONS.find((d) => d.key === direction);
  const filtered = (data?.conflicts || []).filter(
    (c) => typeFilter === 'all' || c.type === typeFilter,
  );
  const counts = {
    duplicate: data?.stats.duplicateCount || 0,
    prefix: data?.stats.prefixCount || 0,
  };

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-report-${direction}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="regression-page migration-page">
      <div className="regression-toolbar">
        <div className="regression-title">
          <h2>🔁 跨平台迁移检查</h2>
          <span className="dim small">
            {currentDirection?.hint} · 只读检查：按每次按键转换修饰键，主键与其他修饰键保持原值 ·
            数据时间：{data ? new Date(data.generatedAt).toLocaleString() : '-'}
          </span>
        </div>
        <div className="regression-actions">
          <button onClick={() => load()} title="按当前数据重新检查">
            重新检查
          </button>
          <button className="primary" onClick={downloadJson} disabled={!data}>
            下载 JSON
          </button>
        </div>
      </div>

      <div className="migration-readonly-notice">
        ℹ️ 本页为只读检查：在内存副本上映射全部命令序列并复用审校页的最近祖先 / 同层重复 /
        前缀判定，只报告迁移<strong>新增</strong>的冲突，不会修改任何命令或持久化数据。
      </div>

      <div className="migration-direction-tabs">
        {DIRECTIONS.map((d) => (
          <button
            key={d.key}
            className={`sim-tab ${direction === d.key ? 'active' : ''}`}
            onClick={() => setDirection(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {error && <p className="error">⚠ {error}</p>}

      {loading ? (
        <div className="loading">迁移检查进行中…</div>
      ) : (
        data && (
          <>
            <div className="stat-grid">
              <StatCard value={data.stats.leafCount} label="叶子上下文" />
              <StatCard value={data.stats.commandCount} label="命令总数" />
              <StatCard
                value={data.stats.migratedCommandCount}
                label={`含 ${currentDirection?.label.split(' ')[0]} 修饰键的命令`}
              />
              <StatCard
                value={data.stats.conflictCount}
                label="迁移新增冲突"
                tone={data.stats.conflictCount > 0 ? 'danger' : 'ok'}
              />
              <StatCard value={data.stats.duplicateCount} label="新增同层重复" tone="warn" />
              <StatCard value={data.stats.prefixCount} label="新增前缀冲突" tone="warn" />
              <StatCard value={data.stats.affectedLeafCount} label="受影响叶子数" />
              <StatCard value={data.stats.affectedCommandCount} label="涉及命令数" />
            </div>

            <div className="migration-filters">
              <span className="dim small">按冲突类型筛选：</span>
              <button
                className={`sim-tab ${typeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                全部（{counts.duplicate + counts.prefix}）
              </button>
              <button
                className={`sim-tab ${typeFilter === 'duplicate' ? 'active' : ''}`}
                onClick={() => setTypeFilter('duplicate')}
              >
                同层重复（{counts.duplicate}）
              </button>
              <button
                className={`sim-tab ${typeFilter === 'prefix' ? 'active' : ''}`}
                onClick={() => setTypeFilter('prefix')}
              >
                前缀冲突（{counts.prefix}）
              </button>
            </div>

            {data.stats.conflictCount === 0 ? (
              <div className="migration-clean">
                ✅ {data.directionLabel} 迁移不会引入新的同层重复或前缀冲突（原有冲突不列入本报告）。
              </div>
            ) : filtered.length === 0 ? (
              <p className="hint">当前筛选下没有冲突。</p>
            ) : (
              <div className="migration-list">
                {filtered.map((c) => (
                  <ConflictRecord key={c.goalId} conflict={c} />
                ))}
              </div>
            )}

            <details className="json-details" onToggle={(e) => setShowJson(e.target.open)}>
              <summary>查看完整 JSON（含每条冲突双方的原序列 / 迁移序列与受影响叶子）</summary>
              {showJson && <pre className="json-pre">{JSON.stringify(data, null, 2)}</pre>}
            </details>
          </>
        )
      )}
    </div>
  );
}
