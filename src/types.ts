import type { Lang } from './language.js';

/** A post as returned by the Threads keyword search (only what we need). */
export interface ThreadsPost {
  id: string;
  text: string;
  username: string;
  /** ISO timestamp from the API. */
  timestamp: string;
  permalink: string;
}

export type Decision = 'replied' | 'skipped';

/** A matched post stored in SQLite. */
export interface Lead {
  postId: string;
  username: string;
  text: string;
  permalink: string;
  publishedAt: number; // epoch ms
  language: Lang;
  reason: string;
  reply: string;
  searchTerm: string;
  foundAt: number;
  deliveryStatus: 'pending' | 'sent';
  deliveryAttempts: number;
  lastDeliveryError: string | null;
  telegramMessageId: number | null;
  deliveredAt: number | null;
  decision: Decision | null;
  decidedAt: number | null;
}
