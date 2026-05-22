import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface UserStats {
  name: string;
  email: string;
  lastActive: number;
  totals: {
    human: { added: number; removed: number };
    copilot: { added: number; removed: number };
    gemini: { added: number; removed: number };
  };
  byLanguage: {
    [lang: string]: { human: number; copilot: number; gemini: number };
  };
  dailyStats: {
    [date: string]: { human: number; copilot: number; gemini: number };
  };
}

export interface DashboardData {
  lastUpdated: number;
  version: '1.0.0';
  users: {
    [email: string]: UserStats;
  };
}

type AIProvider = 'copilot' | 'gemini';

const STORE_DIR = path.join(os.homedir(), '.vscode', 'ai-loc-tracker');
const STORE_FILE = path.join(STORE_DIR, 'stats.json');

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function emptyUserStats(name: string, email: string): UserStats {
  return {
    name,
    email,
    lastActive: Date.now(),
    totals: {
      human: { added: 0, removed: 0 },
      copilot: { added: 0, removed: 0 },
      gemini: { added: 0, removed: 0 },
    },
    byLanguage: {},
    dailyStats: {},
  };
}

function emptyDashboard(): DashboardData {
  return {
    lastUpdated: Date.now(),
    version: '1.0.0',
    users: {},
  };
}

/**
 * Manages the local stats.json at ~/.vscode/ai-loc-tracker/stats.json.
 * All mutations are synchronous writes to avoid data loss on crashes.
 */
export class LocalStore {
  private data: DashboardData;

  constructor() {
    this.data = this.load();
  }

  private load(): DashboardData {
    try {
      if (!fs.existsSync(STORE_FILE)) {
        return emptyDashboard();
      }
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as DashboardData;
      // Validate top-level shape
      if (!parsed.users || typeof parsed.users !== 'object') {
        return emptyDashboard();
      }
      return parsed;
    } catch {
      return emptyDashboard();
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      this.data.lastUpdated = Date.now();
      fs.writeFileSync(STORE_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[AI LoC Tracker] Failed to save local stats:', err);
    }
  }

  public getData(): DashboardData {
    return this.data;
  }

  public getUserStats(email: string): UserStats | undefined {
    return this.data.users[email];
  }

  public recordAILines(
    email: string,
    name: string,
    provider: AIProvider,
    linesAdded: number,
    linesRemoved: number,
    language: string
  ): void {
    const user = this.ensureUser(email, name);
    const date = today();

    user.totals[provider].added += linesAdded;
    user.totals[provider].removed += linesRemoved;
    user.lastActive = Date.now();

    // Per-language and daily use net lines so deletions cancel additions
    const net = linesAdded - linesRemoved;

    if (!user.byLanguage[language]) {
      user.byLanguage[language] = { human: 0, copilot: 0, gemini: 0 };
    }
    user.byLanguage[language][provider] = Math.max(0, user.byLanguage[language][provider] + net);

    if (!user.dailyStats[date]) {
      user.dailyStats[date] = { human: 0, copilot: 0, gemini: 0 };
    }
    user.dailyStats[date][provider] = Math.max(0, user.dailyStats[date][provider] + net);

    this.save();
  }

  public recordHumanLines(
    email: string,
    name: string,
    linesAdded: number,
    linesRemoved: number,
    language: string
  ): void {
    const user = this.ensureUser(email, name);
    const date = today();

    user.totals.human.added += linesAdded;
    user.totals.human.removed += linesRemoved;
    user.lastActive = Date.now();

    const net = linesAdded - linesRemoved;

    if (!user.byLanguage[language]) {
      user.byLanguage[language] = { human: 0, copilot: 0, gemini: 0 };
    }
    user.byLanguage[language].human = Math.max(0, user.byLanguage[language].human + net);

    if (!user.dailyStats[date]) {
      user.dailyStats[date] = { human: 0, copilot: 0, gemini: 0 };
    }
    user.dailyStats[date].human = Math.max(0, user.dailyStats[date].human + net);

    this.save();
  }

  private ensureUser(email: string, name: string): UserStats {
    if (!this.data.users[email]) {
      this.data.users[email] = emptyUserStats(name, email);
    } else {
      // Always keep name up to date
      this.data.users[email].name = name;
    }
    return this.data.users[email];
  }

  /**
   * Merges a remote DashboardData into the local one.
   * Other users' data from the remote is preserved.
   * The current user's local data takes precedence.
   */
  public mergeRemote(remote: DashboardData, currentEmail: string): DashboardData {
    const merged: DashboardData = {
      lastUpdated: Date.now(),
      version: '1.0.0',
      users: { ...remote.users },
    };

    // Current user's local entry always wins
    if (this.data.users[currentEmail]) {
      merged.users[currentEmail] = this.data.users[currentEmail];
    }

    return merged;
  }

  public getFilePath(): string {
    return STORE_FILE;
  }
}
