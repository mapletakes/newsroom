// Network chatter flags: the shapes and limits shared by the API routes and the
// browser. No server-only imports belong here.

export const FLAG_CATEGORIES = {
  harassment: 'Harassment',
  hate: 'Hate or slurs',
  spam: 'Spam or bot',
  ban_evasion: 'Ban evasion',
  doxxing: 'Doxxing or threats',
  other: 'Other',
} as const;

export type FlagCategory = keyof typeof FLAG_CATEGORIES;

export function isFlagCategory(value: unknown): value is FlagCategory {
  return typeof value === 'string' && Object.hasOwn(FLAG_CATEGORIES, value);
}

/** Room for a full account of what happened when there's no log to point at. */
export const MAX_FLAG_CONTEXT = 4000;
/** A whole page of the log can go into one flag. */
export const MAX_FLAG_MESSAGES = 200;
/** The same as the suspicious log's retention, so a flag can't outlive its evidence. */
export const FLAG_TTL_DAYS = 365;

/** 'removed' means an admin took it down. */
export type FlagStatus = 'active' | 'withdrawn' | 'expired' | 'removed';

/** A log entry attached to a flag, as Twitch reported it. */
export type FlagMessage = {
  id: string;
  sent_at: string;
  message_text: string;
  low_trust_status: string;
};

/** A flag as the channel that made it sees it. `created_by_login` never leaves
 *  the channel: the network view will use a different shape without it. */
export type ChannelFlag = {
  id: string;
  chatter_user_id: string;
  chatter_login: string;
  chatter_name: string;
  category: FlagCategory;
  context: string;
  created_by_login: string;
  created_at: string;
  updated_at: string | null;
  expires_at: string;
  status: FlagStatus;
  /** Whether the person asking made it. */
  mine: boolean;
  /** The streamer, or whoever made it, can change its category and context and withdraw it. */
  canEdit: boolean;
  /** The admin's reason, when status is 'removed'. */
  removed_reason: string | null;
  messages: FlagMessage[];
};

export type FlagsResponse = { flags: ChannelFlag[] };

// ── The network: other channels' flags, as a receiving channel sees them ──

export const REVIEW_DECISIONS = {
  banned: 'Banned',
  watching: 'Watching',
  dismissed: 'Dismissed',
} as const;

export type ReviewDecision = keyof typeof REVIEW_DECISIONS;

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === 'string' && Object.hasOwn(REVIEW_DECISIONS, value);
}

/** Another channel's flag. Names the channel and the Twitch login of the
 *  person who made it, so the receiving team knows who to ask for details. */
export type NetworkFlag = {
  id: string;
  channelName: string;
  flaggedBy: string;
  category: FlagCategory;
  context: string;
  created_at: string;
  updated_at: string | null;
  messages: FlagMessage[];
};

/** Everything the network says about one chatter, and what this channel decided. */
export type NetworkChatter = {
  chatter_user_id: string;
  chatter_login: string;
  chatter_name: string;
  flags: NetworkFlag[];
  /** When the newest flag was made or last changed. */
  latest_at: string;
  review: { decision: ReviewDecision; decided_by_login: string; decided_at: string } | null;
  /** Never reviewed, or a flag arrived or changed since the review. */
  isNew: boolean;
  /** Whether they're in this channel's own suspicious log too. */
  inMyLog: boolean;
};

export type NetworkFilter = 'new' | 'all' | ReviewDecision;

export function parseNetworkFilter(value: string | null): NetworkFilter {
  if (value === 'all' || isReviewDecision(value)) return value;
  return 'new';
}

export type NetworkResponse = {
  logEnabled: boolean;
  subscribed: boolean;
  /** Only the streamer can turn receiving flags on or off. */
  canSubscribe: boolean;
  chatters: NetworkChatter[];
  /** True when there were more live flags than one page loads. */
  truncated: boolean;
};

// ── Admin ──

/** Matches the column's check constraint. */
export const MAX_REMOVAL_REASON = 500;

/** A channel's flag as an admin sees it: everything, including who made it. */
export type AdminFlag = {
  id: string;
  chatter_login: string;
  chatter_name: string;
  category: FlagCategory;
  context: string;
  created_by_login: string;
  created_at: string;
  status: FlagStatus;
  removed_by_login: string | null;
  removed_reason: string | null;
  messages: FlagMessage[];
};

/** What the flag dialog needs to know before flagging a chatter. */
export type FlagTarget =
  | { kind: 'chatter'; chatterId: string; chatterName: string; messageIds: string[] }
  | { kind: 'login' };
