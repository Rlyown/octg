import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

interface WhitelistEntry {
  id: string;
  type: 'user' | 'group';
  username?: string;
  title?: string;
  pairedAt: string;
  pairedBy: string;
}

interface PairingCode {
  code: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
}

interface WhitelistData {
  users: WhitelistEntry[];
  groups: WhitelistEntry[];
  pairingCodes: PairingCode[];
}

export class WhitelistManager {
  private filePath: string;
  private data: WhitelistData;
  private ttlMinutes: number;

  constructor(filePath: string, ttlMinutes: number = 2) {
    this.filePath = filePath;
    this.ttlMinutes = ttlMinutes;
    this.data = this.load();
  }

  private reload(): void {
    this.data = this.load();
  }

  private load(): WhitelistData {
    if (existsSync(this.filePath)) {
      try {
        const content = readFileSync(this.filePath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Invalid JSON, start fresh
      }
    }
    return { users: [], groups: [], pairingCodes: [] };
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  // Generate new pairing code
  generatePairingCode(): string {
    this.reload();

    // Clean expired codes first
    this.cleanExpiredCodes();

    // Generate 8-character alphanumeric code
    const code = randomBytes(4).toString('hex').toUpperCase();
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

    this.data.pairingCodes.push({
      code,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    this.save();
    return code;
  }

  // Verify and use pairing code
  verifyPairingCode(code: string): boolean {
    this.reload();
    this.cleanExpiredCodes();

    const pairingCode = this.data.pairingCodes.find(
      c => c.code === code.toUpperCase() && !c.usedBy
    );

    if (!pairingCode) {
      return false;
    }

    // Check if expired
    if (new Date() > new Date(pairingCode.expiresAt)) {
      return false;
    }

    return true;
  }

  // Use pairing code for a user/group
  usePairingCode(code: string, id: string, type: 'user' | 'group', info: { username?: string; title?: string }): boolean {
    this.reload();

    if (!this.verifyPairingCode(code)) {
      return false;
    }

    const pairingCode = this.data.pairingCodes.find(
      c => c.code === code.toUpperCase() && !c.usedBy
    );

    if (!pairingCode) {
      return false;
    }

    // Mark code as used
    pairingCode.usedBy = id;
    pairingCode.usedAt = new Date().toISOString();

    // Add to whitelist
    const entry: WhitelistEntry = {
      id,
      type,
      username: info.username,
      title: info.title,
      pairedAt: new Date().toISOString(),
      pairedBy: pairingCode.code,
    };

    if (type === 'user') {
      // Remove existing entry if any
      this.data.users = this.data.users.filter(u => u.id !== id);
      this.data.users.push(entry);
    } else {
      this.data.groups = this.data.groups.filter(g => g.id !== id);
      this.data.groups.push(entry);
    }

    this.save();
    return true;
  }

  // Check if id is whitelisted
  isWhitelisted(id: string, type: 'user' | 'group'): boolean {
    this.reload();

    if (type === 'user') {
      return this.data.users.some(u => u.id === id);
    }
    return this.data.groups.some(g => g.id === id);
  }

  // Remove from whitelist
  removeFromWhitelist(id: string, type: 'user' | 'group'): boolean {
    this.reload();

    if (type === 'user') {
      const index = this.data.users.findIndex(u => u.id === id);
      if (index >= 0) {
        this.data.users.splice(index, 1);
        this.save();
        return true;
      }
    } else {
      const index = this.data.groups.findIndex(g => g.id === id);
      if (index >= 0) {
        this.data.groups.splice(index, 1);
        this.save();
        return true;
      }
    }
    return false;
  }

  // Get current valid pairing code
  getCurrentPairingCode(): PairingCode | undefined {
    this.reload();
    this.cleanExpiredCodes();
    return this.data.pairingCodes.find(c => !c.usedBy && new Date() < new Date(c.expiresAt));
  }

  // Clean expired codes
  private cleanExpiredCodes(): void {
    const now = new Date();
    this.data.pairingCodes = this.data.pairingCodes.filter(c => {
      // Keep if not expired and not used, or if used (for history)
      if (c.usedBy) return true;
      return now < new Date(c.expiresAt);
    });
  }

  // Get whitelist info
  getWhitelist(): WhitelistData {
    this.reload();
    return this.data;
  }

  // Get stats
  getStats(): { users: number; groups: number; activeCodes: number } {
    this.reload();
    this.cleanExpiredCodes();
    return {
      users: this.data.users.length,
      groups: this.data.groups.length,
      activeCodes: this.data.pairingCodes.filter(c => !c.usedBy).length,
    };
  }
}
