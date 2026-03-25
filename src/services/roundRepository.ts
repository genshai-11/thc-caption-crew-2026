import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { GameSettings, RoundRecord } from '@/types';

const SETTINGS_KEY = 'caption-crew-settings';
const HISTORY_KEY = 'caption-crew-history';

export const defaultGameSettings: GameSettings = {
  maxCrewStartDelayMs: 3000,
  strictness: 'medium',
  showCountdown: true,
};

export async function saveSettings(settings: GameSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (db) {
    await setDoc(doc(db, 'game_settings', 'default'), settings);
  }
}

export async function loadSettings(): Promise<GameSettings> {
  if (db) {
    const snap = await getDoc(doc(db, 'game_settings', 'default'));
    if (snap.exists()) {
      const remote = snap.data() as Partial<GameSettings>;
      const merged = { ...defaultGameSettings, ...remote };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return merged;
    }
  }

  const local = localStorage.getItem(SETTINGS_KEY);
  if (local) {
    return { ...defaultGameSettings, ...JSON.parse(local) };
  }
  return defaultGameSettings;
}

export async function saveRound(round: RoundRecord) {
  const local = loadLocalHistory();
  local.unshift(round);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(local.slice(0, 50)));
  if (db) {
    await addDoc(collection(db, 'rounds'), round);
  }
}

export async function loadRecentRounds(): Promise<RoundRecord[]> {
  if (db) {
    const q = query(collection(db, 'rounds'), orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs.map((d) => d.data() as RoundRecord);
    }
  }
  return loadLocalHistory();
}

function loadLocalHistory(): RoundRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}