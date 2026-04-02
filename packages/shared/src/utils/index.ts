export const formatTON = (amount: string): string => {
  const num = parseFloat(amount);
  if (num === 0) return '0 TON';
  if (num < 0.001) return '<0.001 TON';
  return `${num.toFixed(3)} TON`;
};

export const calculateWinRate = (wins: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((wins / total) * 100);
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};
