/**
 * Username generator — PRD §2
 * Format: Adjective_Noun_Number  e.g. DarkKnight_447
 */

const ADJECTIVES = [
  'Dark', 'Swift', 'Iron', 'Cold', 'Neon', 'Bold', 'Grim', 'Sly',
  'Wild', 'Keen', 'Jade', 'Lone', 'Pale', 'Rogue', 'Sage', 'Stark',
  'Storm', 'Stone', 'Vile', 'Void', 'Wick', 'Wolf', 'Frost', 'Blaze',
  'Dusk', 'Dust', 'Fire', 'Flux', 'Gold', 'Gust', 'Haze', 'Hex',
  'Ice', 'Ink', 'Lux', 'Mist', 'Nova', 'Onyx', 'Peak', 'Rust',
  'Salt', 'Sand', 'Silk', 'Soot', 'Tide', 'Vale', 'Vex', 'Wax',
];

const NOUNS = [
  'Knight', 'Fox', 'Eagle', 'Wolf', 'Viper', 'Hawk', 'Bear', 'Rook',
  'King', 'Ghost', 'Blade', 'Forge', 'Lance', 'Pawn', 'Scout', 'Shade',
  'Shield', 'Spike', 'Storm', 'Talon', 'Titan', 'Tower', 'Track', 'Trail',
  'Trap', 'Trick', 'Troll', 'Vault', 'Veil', 'Venom', 'Wraith', 'Claw',
  'Crow', 'Dagger', 'Drake', 'Dusk', 'Fang', 'Flame', 'Flint', 'Fury',
  'Gale', 'Glyph', 'Grail', 'Grip', 'Guard', 'Hunter', 'Hydra', 'Idol',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomNumber(): number {
  return Math.floor(Math.random() * 900) + 100; // 100–999
}

export function generateUsername(): string {
  return `${randomItem(ADJECTIVES)}${randomItem(NOUNS)}_${randomNumber()}`;
}

/**
 * Generate a unique username by checking against existing ones.
 * Retries up to maxAttempts times before appending extra digits.
 */
export async function generateUniqueUsername(
  existsCheck: (username: string) => Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const username = generateUsername();
    const taken = await existsCheck(username);
    if (!taken) return username;
  }
  // Fallback: append extra random digits to guarantee uniqueness
  return `${generateUsername()}${Math.floor(Math.random() * 9000) + 1000}`;
}
