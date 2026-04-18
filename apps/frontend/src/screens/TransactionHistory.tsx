/**
 * TransactionHistory.tsx — Full paginated transaction history
 * Accessible via /history?tab=deposits|withdrawals
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTelegram } from '../hooks/useTelegram';
import { balanceApi } from '../services/api';

type TxType = 'deposit' | 'withdrawal';

interface Tx {
  id:             string;
  type:           TxType;
  status:         string;
  amount:         string;
  tonTxHash?:     string;
  requiresReview: boolean;
  createdAt:      string;
}

const STATUS_LABEL: Record<string, string> = {
  confirmed:  '✅ Confirmed',
  processing: '⏳ Processing',
  pending:    '🕐 Pending review',
  failed:     '❌ Failed',
  rejected:   '↩️ Rejected',
};

const STATUS_COLOR: Record<string, string> = {
  confirmed:  '#4CAF50',
  processing: '#FF8F00',
  pending:    '#2AABEE',
  failed:     'var(--tg-theme-destructive-text-color)',
  rejected:   'var(--tg-theme-hint-color)',
};

export function TransactionHistory() {
  const { showBackButton } = useTelegram();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'deposits') as 'deposits' | 'withdrawals';

  const [txs,     setTxs]     = useState<Tx[]>([]);
  const [page,    setPage]    = useState(1);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);

  const LIMIT = 20;

  useEffect(() => { return showBackButton(() => navigate(-1)); }, []);

  useEffect(() => {
    setTxs([]);
    setPage(1);
    setTotal(0);
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    balanceApi.history(page)
      .then(r => {
        const all = (r.data.transactions ?? []) as Tx[];
        const filtered = all.filter(t =>
          tab === 'deposits' ? t.type === 'deposit' : t.type === 'withdrawal',
        );
        setTxs(prev => page === 1 ? filtered : [...prev, ...filtered]);
        setTotal(r.data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab, page]);

  function switchTab(t: 'deposits' | 'withdrawals') {
    setParams({ tab: t });
  }

  const hasMore = txs.length < total;

  return (
    <div style={s.container}>
      {/* Tabs */}
      <div style={s.tabs}>
        <button
          style={{ ...s.tab, ...(tab === 'deposits' ? s.tabActive : {}) }}
          onClick={() => switchTab('deposits')}
        >
          ⬇️ Deposits
        </button>
        <button
          style={{ ...s.tab, ...(tab === 'withdrawals' ? s.tabActive : {}) }}
          onClick={() => switchTab('withdrawals')}
        >
          ⬆️ Withdrawals
        </button>
      </div>

      {/* List */}
      {txs.length === 0 && !loading && (
        <div style={s.empty}>
          <p style={s.emptyIcon}>{tab === 'deposits' ? '⬇️' : '⬆️'}</p>
          <p style={s.emptyText}>No {tab} yet</p>
        </div>
      )}

      {txs.map(tx => (
        <TxRow key={tx.id} tx={tx} />
      ))}

      {loading && <p style={s.hint}>Loading…</p>}

      {hasMore && !loading && (
        <button style={s.loadMore} onClick={() => setPage(p => p + 1)}>
          Load more
        </button>
      )}
    </div>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const date = new Date(tx.createdAt).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
  const isDeposit = tx.type === 'deposit';
  const amountColor = isDeposit ? '#4CAF50' : 'var(--tg-theme-text-color)';
  const amountPrefix = isDeposit ? '+' : '−';
  const statusLabel = STATUS_LABEL[tx.status] ?? tx.status;
  const statusColor = STATUS_COLOR[tx.status] ?? 'var(--tg-theme-hint-color)';

  return (
    <div style={s.row}>
      <div style={s.rowLeft}>
        <span style={s.rowIcon}>{isDeposit ? '⬇️' : '⬆️'}</span>
        <div>
          <p style={s.rowDate}>{date}</p>
          <p style={{ ...s.rowStatus, color: statusColor }}>{statusLabel}</p>
          {tx.tonTxHash && !tx.tonTxHash.startsWith('pending:') && (
            <p style={s.rowHash}>{tx.tonTxHash.slice(0, 12)}…</p>
          )}
        </div>
      </div>
      <p style={{ ...s.rowAmount, color: amountColor }}>
        {amountPrefix}{parseFloat(tx.amount).toFixed(2)} TON
      </p>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: '0 16px 80px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
  tabs:      { display: 'flex', gap: 8, padding: '16px 0 12px', position: 'sticky', top: 0, background: 'var(--tg-theme-bg-color)', zIndex: 10 },
  tab:       { flex: 1, background: 'var(--tg-theme-secondary-bg-color)', border: '2px solid transparent', borderRadius: 12, padding: '10px', fontSize: 14, fontWeight: 600, color: 'var(--tg-theme-hint-color)', cursor: 'pointer' },
  tabActive: { borderColor: '#2AABEE', color: '#2AABEE', background: 'rgba(42,171,238,0.08)' },
  row:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 },
  rowLeft:   { display: 'flex', alignItems: 'center', gap: 10 },
  rowIcon:   { fontSize: 22 },
  rowDate:   { color: 'var(--tg-theme-text-color)', fontSize: 13, fontWeight: 500, margin: 0 },
  rowStatus: { fontSize: 12, margin: '2px 0 0' },
  rowHash:   { color: 'var(--tg-theme-hint-color)', fontSize: 11, fontFamily: 'monospace', margin: '2px 0 0' },
  rowAmount: { fontSize: 16, fontWeight: 700, margin: 0, flexShrink: 0 },
  hint:      { color: 'var(--tg-theme-hint-color)', fontSize: 13, textAlign: 'center', padding: '16px 0' },
  loadMore:  { width: '100%', background: 'var(--tg-theme-secondary-bg-color)', border: 'none', borderRadius: 12, padding: '12px', color: '#2AABEE', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  empty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 8 },
  emptyIcon: { fontSize: 40, margin: 0 },
  emptyText: { color: 'var(--tg-theme-hint-color)', fontSize: 14, margin: 0 },
};
