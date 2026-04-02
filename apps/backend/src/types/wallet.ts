// Wallet and transaction types — aligned with transactions table schema

export type TransactionType = 'deposit' | 'withdrawal';
export type TransactionStatus = 'pending' | 'processing' | 'confirmed' | 'failed' | 'rejected';

export interface Transaction {
  id:             string;
  userId:         string;
  type:           TransactionType;
  status:         TransactionStatus;
  amount:         string;
  tonTxHash?:     string;
  destination?:   string;
  memo?:          string;
  requiresReview: boolean;
  createdAt:      string;
  updatedAt:      string;
}

export interface BalanceInfo {
  available: string;
  locked:    string;
  total:     string;
}

export interface DepositInstructions {
  address:       string;
  memo:          string;
  minimumAmount: number;
}

export interface WithdrawalRequest {
  amount:      string;
  destination: string;
}
