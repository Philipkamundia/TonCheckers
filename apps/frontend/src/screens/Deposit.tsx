/**
 * Deposit.tsx — One-click deposit via TonConnect (PRD §4)
 * User picks amount → wallet modal opens pre-filled → user signs → done.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { useTelegram } from '../hooks/useTelegram';
import { balanceApi } from '../services/api';

function toNano(ton: number): string { return Math.round(ton * 1_000_000_000).toString(); }

/**
 * Encode a text comment as a valid TON Cell BOC (base64).
 * Produces the exact same output as @ton/core beginCell().storeUint(0,32).storeStringTail(text).endCell().toBoc()
 * Format: single-root BOC containing one cell with 32-bit zero opcode + UTF-8 text.
 */
function encodeTextComment(text: string): string {
  const textBytes = new TextEncoder().encode(text);
  // Cell data: 4 zero bytes (op=0 = text comment) + UTF-8 text
  const data = new Uint8Array(4 + textBytes.length);
  data.set(textBytes, 4);

  const bitLen = data.length * 8;
  // Cell descriptor bytes (d1, d2):
  //   d1 = level_mask(3b) | has_hashes(1b) | is_exotic(1b) | ref_count(3b) = 0x00
  //   d2 = ceil(bitLen/8) + floor(bitLen/8) = 2*byteLen for byte-aligned data
  const d1 = 0x00;
  const d2 = (Math.ceil(bitLen / 8) + Math.floor(bitLen / 8)) & 0xff;

  // Full cell bytes = descriptor(2) + data
  const cell = new Uint8Array(2 + data.length);
  cell[0] = d1;
  cell[1] = d2;
  cell.set(data, 2);

  // Minimal single-root BOC (no index, no CRC):
  // magic(4) | flags(1) | offset_size(1) | cells(1) | roots(1) | absent(1) | tot_size(1) | root_idx(1) | cell_data
  const boc = new Uint8Array([
    0xb5, 0xee, 0x9c, 0x72,  // BOC magic
    0x01,                     // flags: size_bytes=1
    0x01,                     // offset_bytes=1
    0x01,                     // cells_count=1
    0x01,                     // roots_count=1
    0x00,                     // absent_count=0
    cell.length & 0xff,       // tot_cells_size (1 byte)
    0x00,                     // root index = 0
    ...cell,
  ]);

  return btoa(String.fromCharCode(...boc));
}

const MIN_DEPOSIT = 0.5;
const PRESETS = [0.5, 1, 2, 5, 10];

export function Deposit() {
  const { showBackButton, hideMainButton, haptic } = useTelegram();
  const [tonConnectUI] = useTonConnectUI();
  const navigate = useNavigate();

  const [amount,      setAmount]      = useState<string>('1');
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [depositInfo, setDepositInfo] = useState<{ address: string; memo: string } | null>(null);
  const [confirmed,   setConfirmed]   = useState(false);

  useEffect(() => {
    hideMainButton();
    return showBackButton(() => navigate('/'));
  }, []);

  // Pre-fetch deposit address on mount so it's ready instantly
  useEffect(() => {
    balanceApi.depositInit()
      .then(r => setDepositInfo({ address: r.data.address, memo: r.data.memo }))
      .catch(() => null);
  }, []);

  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount >= MIN_DEPOSIT;

  async function handleDeposit() {
    if (!isValid || !depositInfo) return;
    setLoading(true);
    setStatus('pending');
    setErrorMsg(null);
    haptic.impact('medium');

    try {
      // Convert TON to nanotons (1 TON = 1e9 nanotons)
      const nanoAmount = toNano(parsedAmount);

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min window
        messages: [
          {
            address: depositInfo.address,
            amount:  nanoAmount,
            payload: encodeTextComment(depositInfo.memo),
          },
        ],
      });

      setStatus('sent');
      haptic.success();

      // Poll balance every 10s for up to 3 minutes to detect confirmation
      let attempts = 0;
      const initialBalance = await balanceApi.get().then(r => parseFloat(r.data.balance.available)).catch(() => 0);
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await balanceApi.get();
          const newBalance = parseFloat(r.data.balance.available);
          if (newBalance > initialBalance) {
            setConfirmed(true);
            clearInterval(poll);
          }
        } catch { /* ignore */ }
        if (attempts >= 18) clearInterval(poll); // stop after 3 min
      }, 10_000);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('declined')) {
        setStatus('idle');
      } else {
        setStatus('error');
        setErrorMsg(`Transaction failed: ${msg || 'Please try again.'}`);
        haptic.error();
      }
    } finally {
      setLoading(false);
    }
  }

  if (status === 'sent') {
    return (
      <div style={s.container}>
        <div style={s.successBox}>
          <p style={s.successIcon}>{confirmed ? '✅' : '⏳'}</p>
          <p style={s.successTitle}>{confirmed ? 'Deposit Confirmed!' : 'Transaction Sent'}</p>
          <p style={s.successDesc}>
            {confirmed
              ? `Your balance has been credited with ${parsedAmount} TON.`
              : `Your deposit of ${parsedAmount} TON is on its way. Waiting for on-chain confirmation…`}
          </p>
          <button style={s.btn} onClick={() => navigate('/')}>Back to Home</button>
          <button style={s.outlineBtn} onClick={() => { setStatus('idle'); setConfirmed(false); }}>Deposit More</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <h2 style={s.title}>Deposit TON</h2>
      <p style={s.hint}>Minimum {MIN_DEPOSIT} TON · Balance updates in ~60s</p>

      {/* Amount presets */}
      <div style={s.presets}>
        {PRESETS.map(p => (
          <button
            key={p}
            style={{ ...s.preset, ...(amount === String(p) ? s.presetActive : {}) }}
            onClick={() => setAmount(String(p))}
          >
            {p} TON
          </button>
        ))}
      </div>

      {/* Custom amount */}
      <div style={s.inputRow}>
        <input
          style={s.input}
          type="number"
          min={MIN_DEPOSIT}
          step="0.1"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={`Min ${MIN_DEPOSIT}`}
        />
        <span style={s.inputSuffix}>TON</span>
      </div>

      {!isValid && amount !== '' && (
        <p style={s.validationMsg}>Minimum deposit is {MIN_DEPOSIT} TON</p>
      )}

      {/* Deposit info preview */}
      {depositInfo && (
        <div style={s.infoCard}>
          <Row label="To"     value={`${depositInfo.address.slice(0, 10)}...${depositInfo.address.slice(-6)}`} />
          <Row label="Memo"   value={depositInfo.memo} mono />
          <Row label="Amount" value={isValid ? `${parsedAmount} TON` : '—'} highlight />
        </div>
      )}

      <button
        style={{ ...s.btn, ...(!isValid || loading || !depositInfo ? s.btnDisabled : {}) }}
        onClick={handleDeposit}
        disabled={!isValid || loading || !depositInfo}
      >
        {loading ? 'Opening Wallet…' : `Deposit ${isValid ? parsedAmount + ' TON' : ''}`}
      </button>

      {errorMsg && <p style={s.error}>{errorMsg}</p>}

      <p style={s.note}>
        Your wallet will open automatically. The memo is pre-filled — just confirm and sign.
      </p>
    </div>
  );
}

function Row({ label, value, mono, highlight }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
      <span style={{ color: 'var(--tg-theme-hint-color)', fontSize: 13 }}>{label}</span>
      <span style={{ color: highlight ? '#4CAF50' : 'var(--tg-theme-text-color)', fontSize: 13, fontWeight: 500, fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container:     { padding: '16px', background: 'var(--tg-theme-bg-color)', minHeight: '100vh' },
  title:         { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  hint:          { color: 'var(--tg-theme-hint-color)', fontSize: 13, margin: '0 0 20px' },
  presets:       { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  preset:        { background: 'var(--tg-theme-secondary-bg-color)', border: '2px solid transparent', borderRadius: 10, padding: '8px 14px', color: 'var(--tg-theme-text-color)', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  presetActive:  { borderColor: '#2AABEE', background: 'rgba(42,171,238,0.1)', color: '#2AABEE' },
  inputRow:      { display: 'flex', alignItems: 'center', background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 12, padding: '4px 14px', marginBottom: 8 },
  input:         { flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--tg-theme-text-color)', fontSize: 20, fontWeight: 600, padding: '10px 0' },
  inputSuffix:   { color: 'var(--tg-theme-hint-color)', fontSize: 16, fontWeight: 500 },
  validationMsg: { color: '#ff3b30', fontSize: 12, margin: '0 0 8px' },
  infoCard:      { background: 'var(--tg-theme-secondary-bg-color)', borderRadius: 14, padding: '4px 14px', margin: '16px 0' },
  btn:           { width: '100%', background: '#2AABEE', border: 'none', borderRadius: 14, padding: '16px', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', marginBottom: 10 },
  btnDisabled:   { opacity: 0.5, cursor: 'not-allowed' },
  outlineBtn:    { width: '100%', background: 'none', border: '1.5px solid #2AABEE', borderRadius: 14, padding: '14px', color: '#2AABEE', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  error:         { color: '#ff3b30', fontSize: 13, textAlign: 'center', margin: '8px 0' },
  note:          { color: 'var(--tg-theme-hint-color)', fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 1.5 },
  successBox:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 16px', gap: 12 },
  successIcon:   { fontSize: 56, margin: 0 },
  successTitle:  { color: 'var(--tg-theme-text-color)', fontSize: 22, fontWeight: 700, margin: 0 },
  successDesc:   { color: 'var(--tg-theme-hint-color)', fontSize: 14, textAlign: 'center', lineHeight: 1.6, margin: 0 },
};

