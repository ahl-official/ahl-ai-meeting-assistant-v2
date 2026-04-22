import { useState, useEffect } from 'react';
import styles from '../styles/MeetingDetail.module.css';

const PRIORITY_BADGE = {
    critical: { background: '#FCEBEB', color: '#791F1F' },
    high: { background: '#FCEBEB', color: '#791F1F' },
    medium: { background: '#FAEEDA', color: '#633806' },
    low: { background: '#EAF3DE', color: '#27500A' },
};

const DOT_COLOR = {
    critical: '#E24B4A',
    high: '#E24B4A',
    medium: '#EF9F27',
    low: '#639922',
};

function PriBadge({ p }) {
    const s = PRIORITY_BADGE[p] || PRIORITY_BADGE.medium;
    return (
        <span style={{ ...s, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
            {p}
        </span>
    );
}

export default function TasksPanel({ actionPoints, tasks: propTasks, onTasksChange }) {
    const [view, setView] = useState('ap');
    const [tasks, setTasks] = useState(propTasks || []);
    const [aps, setAps] = useState(actionPoints || []);
    const [editingAP, setEditingAP] = useState(null);
    const [editingTask, setEditingTask] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError] = useState('');

    // ── Sync internal state when parent passes new props (e.g. after fetch) ──
    // These effects only call setState directly — they do NOT fire onTasksChange,
    // because the parent already has the same data. onTasksChange is only called
    // from explicit user interactions (commitAPs / commitTasks below).
    useEffect(() => { setAps(actionPoints || []); }, [actionPoints]);
    useEffect(() => { setTasks(propTasks || []); }, [propTasks]);

    // ── Commit helpers — call setState AND notify parent ──────────────────────
    // All user-initiated mutations (add, edit, remove, generate) must go through
    // one of these two functions so the parent can auto-save to Sheets.
    const commitAPs = (next) => {
        setAps(next);
        onTasksChange?.({ actionPoints: next, tasks });
    };

    const commitTasks = (next) => {
        setTasks(next);
        onTasksChange?.({ actionPoints: aps, tasks: next });
    };

    // ── Action point helpers ──────────────────────────────────────────────────
    const updateAP = (i, field, val) => {
        const next = [...aps];
        next[i] = { ...next[i], [field]: val };
        commitAPs(next);
    };

    const removeAP = (i) => commitAPs(aps.filter((_, j) => j !== i));

    const addAP = () => {
        const next = [
            ...aps,
            { id: Date.now().toString(), task: '', owner: '', priority: 'medium', dueDate: 'TBD' },
        ];
        commitAPs(next);
        setEditingAP(next.length - 1);
    };

    // ── Task helpers ──────────────────────────────────────────────────────────
    const updateTask = (i, patch) => {
        const next = [...tasks];
        next[i] = { ...next[i], ...patch };
        commitTasks(next);
    };

    const removeTask = (i) => commitTasks(tasks.filter((_, j) => j !== i));

    const addTask = () => {
        const next = [
            ...tasks,
            {
                id: Date.now().toString(),
                title: '',
                priority: 'medium',
                owner: '',
                dueDate: '',
                details: [],
                sourceActionPoints: [],
            },
        ];
        commitTasks(next);
        setEditingTask(next.length - 1);
    };

    // ── AI task generation ────────────────────────────────────────────────────
    const generateTasks = async () => {
        if (!aps.length) {
            setGenError('Add some action points first.');
            return;
        }
        setGenerating(true);
        setGenError('');
        try {
            const res = await fetch('/api/generate-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionPoints: aps }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Generation failed');
            // commitTasks notifies parent → triggers auto-save in [id].js
            commitTasks(data.tasks);
            setView('tasks');
        } catch (err) {
            setGenError(err.message);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className={'card ' + styles.card}>

            {/* ── Toggle bar ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ display: 'flex', border: '0.5px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                    {[
                        { key: 'ap', label: '◉ Action Points', count: aps.length, badge: 'badge-blue' },
                        { key: 'tasks', label: '✦ Tasks', count: tasks.length, badge: 'badge-purple' },
                    ].map(item => (
                        <button
                            key={item.key}
                            onClick={() => { setView(item.key); setEditingAP(null); setEditingTask(null); }}
                            style={{
                                padding: '7px 16px',
                                border: 'none',
                                fontFamily: 'inherit',
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: view === item.key ? '#EFF6FF' : 'transparent',
                                color: view === item.key ? 'var(--blue)' : 'var(--gray-400)',
                                transition: 'all 0.15s',
                            }}
                        >
                            {item.label}
                            <span className={'badge ' + item.badge}>{item.count}</span>
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    {view === 'ap' ? (
                        <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12, padding: '6px 12px' }}
                            onClick={addAP}
                        >
                            + Add
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: 12, padding: '6px 12px' }}
                                onClick={addTask}
                            >
                                + Add
                            </button>
                            <button
                                className="btn btn-secondary"
                                style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
                                onClick={generateTasks}
                                disabled={generating}
                            >
                                {generating
                                    ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Generating…</>
                                    : '✦ Generate tasks'
                                }
                            </button>
                        </>
                    )}
                </div>
            </div>

            {genError && (
                <div className={styles.error} style={{ marginBottom: 12 }}>{genError}</div>
            )}

            {/* ── Action Points view ── */}
            {view === 'ap' && (
                <div className={styles.apList}>
                    {!aps.length && (
                        <p className={styles.empty}>No action points captured.</p>
                    )}
                    {aps.map((ap, i) => {
                        if (editingAP === i) {
                            return (
                                <div key={i} className={styles.apEditItem}>
                                    <div className={styles.apEditRow}>
                                        <input
                                            className="input"
                                            placeholder="Task description"
                                            value={ap.task}
                                            onChange={e => updateAP(i, 'task', e.target.value)}
                                        />
                                        <button
                                            className="btn btn-ghost"
                                            style={{ padding: '8px 12px', flexShrink: 0 }}
                                            onClick={() => setEditingAP(null)}
                                        >
                                            ✓ Done
                                        </button>
                                    </div>
                                    <div className={styles.apEditMeta}>
                                        <input
                                            className="input"
                                            placeholder="Owner"
                                            value={ap.owner}
                                            onChange={e => updateAP(i, 'owner', e.target.value)}
                                            style={{ flex: 1 }}
                                        />
                                        <select
                                            className="input"
                                            value={ap.priority}
                                            onChange={e => updateAP(i, 'priority', e.target.value)}
                                            style={{ flex: 0.8 }}
                                        >
                                            <option value="high">High</option>
                                            <option value="medium">Medium</option>
                                            <option value="low">Low</option>
                                        </select>
                                        <input
                                            className="input"
                                            placeholder="Due date"
                                            value={ap.dueDate}
                                            onChange={e => updateAP(i, 'dueDate', e.target.value)}
                                            style={{ flex: 1 }}
                                        />
                                    </div>
                                </div>
                            );
                        }
                        return (
                            <div key={i} className={styles.apItem}>
                                <div className={styles.apLeft}>
                                    <span
                                        className={styles.priorityDot}
                                        style={{ background: DOT_COLOR[ap.priority] || '#9CA3AF', marginTop: 5 }}
                                    />
                                    <div>
                                        <div className={styles.apTask}>
                                            {ap.task || <em style={{ color: 'var(--gray-400)' }}>Untitled</em>}
                                        </div>
                                        <div className={styles.apMeta}>
                                            <span>👤 {ap.owner || 'Unassigned'}</span>
                                            <span>📅 {ap.dueDate || 'TBD'}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                                    <PriBadge p={ap.priority} />
                                    <button
                                        className="btn btn-ghost"
                                        style={{ padding: '5px 8px', fontSize: 12 }}
                                        onClick={() => setEditingAP(i)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        className="btn btn-danger"
                                        style={{ padding: '5px 8px' }}
                                        onClick={() => removeAP(i)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Tasks view ── */}
            {view === 'tasks' && (
                <div>
                    {!tasks.length && (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--gray-400)' }}>
                            <div style={{ fontSize: 32, marginBottom: 10 }}>✦</div>
                            <p style={{ fontWeight: 500, marginBottom: 6, color: 'var(--gray-600)', fontSize: 14 }}>
                                No tasks generated yet
                            </p>
                            <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                                Switch to <strong>Action Points</strong>, then click{' '}
                                <strong>Generate tasks</strong> to have AI read all your action points together
                                and create structured, granular tasks.
                            </p>
                        </div>
                    )}

                    {tasks.map((task, i) => {
                        if (editingTask === i) {
                            return (
                                <div
                                    key={i}
                                    style={{
                                        border: '0.5px solid var(--gray-200)',
                                        borderRadius: 10,
                                        padding: '14px 16px',
                                        marginBottom: 12,
                                        background: 'var(--off-white)',
                                    }}
                                >
                                    <input
                                        className="input"
                                        placeholder="Task title"
                                        value={task.title}
                                        style={{ marginBottom: 8, width: '100%' }}
                                        onChange={e => updateTask(i, { title: e.target.value })}
                                    />
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                        <select
                                            className="input"
                                            value={task.priority}
                                            style={{ flex: 0.8 }}
                                            onChange={e => updateTask(i, { priority: e.target.value })}
                                        >
                                            <option value="critical">Critical</option>
                                            <option value="high">High</option>
                                            <option value="medium">Medium</option>
                                            <option value="low">Low</option>
                                        </select>
                                        <input
                                            className="input"
                                            placeholder="Owner"
                                            value={task.owner}
                                            style={{ flex: 1 }}
                                            onChange={e => updateTask(i, { owner: e.target.value })}
                                        />
                                        <input
                                            className="input"
                                            placeholder="Due date"
                                            value={task.dueDate}
                                            style={{ flex: 1 }}
                                            onChange={e => updateTask(i, { dueDate: e.target.value })}
                                        />
                                    </div>
                                    <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>
                                        Details / acceptance criteria (one per line)
                                    </label>
                                    <textarea
                                        className="input"
                                        rows={3}
                                        placeholder={'e.g. Send to all leads by EOD\nDepends on design sign-off'}
                                        value={(task.details || []).join('\n')}
                                        onChange={e => updateTask(i, { details: e.target.value.split('\n').filter(Boolean) })}
                                        style={{ width: '100%' }}
                                    />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                        <button
                                            className="btn btn-ghost"
                                            style={{ fontSize: 13 }}
                                            onClick={() => setEditingTask(null)}
                                        >
                                            ✓ Done
                                        </button>
                                        <button
                                            className="btn btn-danger"
                                            style={{ fontSize: 13, marginLeft: 'auto' }}
                                            onClick={() => removeTask(i)}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={i}
                                style={{
                                    border: '0.5px solid var(--gray-200)',
                                    borderRadius: 10,
                                    padding: '12px 14px',
                                    marginBottom: 10,
                                    background: '#fff',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-800)', lineHeight: 1.45, flex: 1 }}>
                                        {task.title || <em style={{ color: 'var(--gray-400)' }}>Untitled</em>}
                                    </span>
                                    <button
                                        className="btn btn-ghost"
                                        style={{ padding: '4px 8px', fontSize: 11, flexShrink: 0 }}
                                        onClick={() => setEditingTask(i)}
                                    >
                                        Edit
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                                    <PriBadge p={task.priority} />
                                    <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>👤 {task.owner || 'Unassigned'}</span>
                                    <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>📅 {task.dueDate || '—'}</span>
                                </div>

                                {task.details && task.details.length > 0 && (
                                    <ul style={{ paddingLeft: 16, margin: '6px 0 0' }}>
                                        {task.details.map((d, j) => (
                                            <li key={j} style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.6 }}>
                                                {d}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {task.sourceActionPoints && task.sourceActionPoints.length > 0 && (
                                    <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>From AP:</span>
                                        {task.sourceActionPoints.map(idx => {
                                            if (!aps[idx]) return null;
                                            return (
                                                <span
                                                    key={idx}
                                                    style={{
                                                        fontSize: 10,
                                                        background: 'var(--off-white)',
                                                        border: '0.5px solid var(--gray-200)',
                                                        borderRadius: 4,
                                                        padding: '1px 6px',
                                                        color: 'var(--gray-500)',
                                                    }}
                                                >
                                                    {aps[idx].task ? aps[idx].task.slice(0, 35) + '…' : 'AP ' + (idx + 1)}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}