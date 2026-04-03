/**
 * Client-side move generation — mirrors backend engine/moves.ts
 * Used to highlight legal moves and prevent illegal move attempts.
 */

export type Square = 0 | 1 | 2 | 3 | 4;
export type Board  = Square[][];
export type Player = 1 | 2;

export interface Move {
  from: { row: number; col: number };
  to:   { row: number; col: number };
  captures: { row: number; col: number }[];
}

const EMPTY = 0;
const P1 = 1, P2 = 2, P1_KING = 3, P2_KING = 4;
const ALL_DIRS: [number, number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];

function inBounds(r: number, c: number) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isOwn(sq: Square, p: Player)  { return p === 1 ? sq === P1 || sq === P1_KING : sq === P2 || sq === P2_KING; }
function isOpp(sq: Square, p: Player)  { return p === 1 ? sq === P2 || sq === P2_KING : sq === P1 || sq === P1_KING; }
function isKing(sq: Square)            { return sq === P1_KING || sq === P2_KING; }
function clone(b: Board): Board        { return b.map(r => [...r] as Square[]); }

function fwdDirs(sq: Square): [number,number][] {
  if (sq === P1) return [[-1,-1],[-1,1]];
  if (sq === P2) return [[1,-1],[1,1]];
  return ALL_DIRS;
}

function simpleMovesFor(board: Board, row: number, col: number): Move[] {
  const sq = board[row][col];
  const dirs = isKing(sq) ? ALL_DIRS : fwdDirs(sq);
  const moves: Move[] = [];
  for (const [dr,dc] of dirs) {
    const nr=row+dr, nc=col+dc;
    if (inBounds(nr,nc) && board[nr][nc] === EMPTY)
      moves.push({ from:{row,col}, to:{row:nr,col:nc}, captures:[] });
  }
  return moves;
}

function captureChains(
  board: Board, row: number, col: number, player: Player,
  captured: Set<string>, start: {row:number;col:number}, king: boolean,
): Move[] {
  const results: Move[] = [];
  for (const [dr,dc] of ALL_DIRS) {
    if (king) {
      let sr=row+dr, sc=col+dc;
      while (inBounds(sr,sc) && board[sr][sc] === EMPTY) { sr+=dr; sc+=dc; }
      if (!inBounds(sr,sc)) continue;
      const mk = `${sr},${sc}`;
      if (captured.has(mk) || !isOpp(board[sr][sc], player)) continue;
      // Land on single adjacent square immediately after captured piece
      const lr=sr+dr, lc=sc+dc;
      if (!inBounds(lr,lc) || board[lr][lc] !== EMPTY) continue;
      const nc2 = new Set(captured); nc2.add(mk);
      const tb = clone(board); tb[sr][sc]=EMPTY; tb[lr][lc]=tb[row][col]; tb[row][col]=EMPTY;
      const cont = captureChains(tb,lr,lc,player,nc2,start,true);
      if (cont.length) results.push(...cont);
      else results.push({ from:start, to:{row:lr,col:lc}, captures:Array.from(nc2).map(k=>{const[r,c]=k.split(',').map(Number);return{row:r,col:c};}) });
    } else {
      const mr=row+dr, mc=col+dc, lr=row+2*dr, lc=col+2*dc;
      if (!inBounds(lr,lc) || board[lr][lc]!==EMPTY) continue;
      const mk=`${mr},${mc}`;
      if (captured.has(mk) || !isOpp(board[mr][mc], player)) continue;
      const nc2=new Set(captured); nc2.add(mk);
      const tb=clone(board); tb[mr][mc]=EMPTY; tb[lr][lc]=tb[row][col]; tb[row][col]=EMPTY;
      const cont=captureChains(tb,lr,lc,player,nc2,start,false);
      if (cont.length) results.push(...cont);
      else results.push({ from:start, to:{row:lr,col:lc}, captures:Array.from(nc2).map(k=>{const[r,c]=k.split(',').map(Number);return{row:r,col:c};}) });
    }
  }
  return results;
}

export function getAvailableMoves(board: Board, player: Player): Move[] {
  const captures: Move[] = [], simple: Move[] = [];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    if (!isOwn(board[r][c], player)) continue;
    const caps = captureChains(board,r,c,player,new Set(),{row:r,col:c},isKing(board[r][c]));
    if (caps.length) captures.push(...caps);
    else simple.push(...simpleMovesFor(board,r,c));
  }
  if (!captures.length) return simple;
  const max = Math.max(...captures.map(m=>m.captures.length));
  return captures.filter(m=>m.captures.length===max);
}
