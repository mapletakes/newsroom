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

export type FlagStatus = 'active' | 'withdrawn' | 'expired';

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
  messages: FlagMessage[];
};

export type FlagsResponse = { flags: ChannelFlag[] };

/** What the flag dialog needs to know before flagging a chatter. */
export type FlagTarget =
  | { kind: 'chatter'; chatterId: string; chatterName: string; messageIds: string[] }
  | { kind: 'login' };
