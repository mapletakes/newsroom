// The relay's moving parts, kept out of the React component so the order of
// things (connect → report scenes → run commands → report results, retry on a
// drop) can be tested without a browser.

import type { ControlSnapshot } from '@/lib/stream-control-shared';
import { StreamlabsClient, StreamlabsError } from '@/lib/streamlabs-client';

export type RelayPhase = 'idle' | 'connecting' | 'connected' | 'retrying' | 'error';
export type RelayLogEntry = { at: number; text: string; tone: 'ok' | 'bad' | 'info' };

type ClaimedCommand = { id: string; kind: string; args: Record<string, unknown>; actor_login: string };

export type RelayCallbacks = {
  onPhase: (phase: RelayPhase, error: string | null) => void;
  onSnapshot: (snapshot: ControlSnapshot) => void;
  /** Whether the last report to broadside got through. */
  onSync: (ok: boolean) => void;
  onLog: (entry: RelayLogEntry) => void;
};

export const RETRY_MS = 5000;
const SNAPSHOT_DEBOUNCE_MS = 250;

type Deps = {
  fetch: typeof fetch;
  createClient: (opts: { onChange: () => void; onClose: () => void }) => Pick<
    StreamlabsClient,
    'connect' | 'close' | 'readSnapshot' | 'switchScene' | 'setVisibility'
  >;
  now: () => number;
};

const defaultDeps = (): Deps => ({
  fetch: (...args) => fetch(...args),
  createClient: (opts) => new StreamlabsClient(opts),
  now: () => Date.now(),
});

export function createRelay(cb: RelayCallbacks, deps: Deps = defaultDeps()) {
  let client: ReturnType<Deps['createClient']> | null = null;
  let token = '';
  let wanted = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let latest: ControlSnapshot | null = null;
  let claiming = false;
  let claimAgain = false;

  const log = (text: string, tone: RelayLogEntry['tone'] = 'info') => cb.onLog({ at: deps.now(), text, tone });

  const post = async (path: string, body?: unknown): Promise<Response | null> => {
    try {
      const r = await deps.fetch(`/api/stream-control/relay/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      cb.onSync(r.ok);
      return r;
    } catch {
      cb.onSync(false);
      return null;
    }
  };

  const reportState = (connected: boolean, snapshot?: ControlSnapshot) =>
    post('state', snapshot ? { connected, snapshot } : { connected });

  async function pushSnapshot() {
    if (!client) return;
    try {
      const snapshot = await client.readSnapshot();
      latest = snapshot;
      cb.onSnapshot(snapshot);
      await reportState(true, snapshot);
    } catch (err) {
      log(`Couldn't read scenes from Streamlabs: ${(err as Error).message}`, 'bad');
    }
  }

  function scheduleSnapshot() {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      void pushSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  const sceneName = (id: unknown) => latest?.scenes.find((s) => s.id === id)?.name || 'a scene';
  const itemName = (sceneId: unknown, itemId: unknown) =>
    latest?.scenes.find((s) => s.id === sceneId)?.items.find((i) => i.id === itemId)?.name || 'a source';

  // The two verbs. Anything else that ever reaches here is refused, not run.
  async function run(cmd: ClaimedCommand): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    if (!client) return { ok: false, error: 'Relay lost Streamlabs.' };
    const a = cmd.args;
    try {
      if (cmd.kind === 'switch_scene' && typeof a.sceneId === 'string') {
        await client.switchScene(a.sceneId);
        return { ok: true, text: `${cmd.actor_login} switched to ${sceneName(a.sceneId)}` };
      }
      if (
        cmd.kind === 'set_visibility' &&
        typeof a.sceneId === 'string' &&
        typeof a.itemId === 'string' &&
        typeof a.visible === 'boolean'
      ) {
        await client.setVisibility(a.sceneId, a.itemId, a.visible);
        return {
          ok: true,
          text: `${cmd.actor_login} ${a.visible ? 'showed' : 'hid'} ${itemName(a.sceneId, a.itemId)}`,
        };
      }
      return { ok: false, error: 'Unsupported command.' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Picks up and runs whatever is queued. Safe to call as often as pings
   *  arrive: calls during a run fold into one more pass afterwards. */
  async function claim() {
    if (!client) return;
    if (claiming) {
      claimAgain = true;
      return;
    }
    claiming = true;
    try {
      do {
        claimAgain = false;
        const r = await post('claim');
        if (!r?.ok) break;
        const { commands } = (await r.json()) as { commands: ClaimedCommand[] };
        for (const cmd of commands) {
          const outcome = await run(cmd);
          if (outcome.ok) log(outcome.text, 'ok');
          else log(`${cmd.actor_login}'s request failed: ${outcome.error}`, 'bad');
          await post('result', outcome.ok ? { id: cmd.id, ok: true } : { id: cmd.id, ok: false, error: outcome.error });
        }
      } while (claimAgain && client);
    } finally {
      claiming = false;
    }
  }

  function scheduleRetry() {
    if (retryTimer || !wanted) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wanted) void open(true);
    }, RETRY_MS);
  }

  async function open(isRetry: boolean) {
    cb.onPhase(isRetry ? 'retrying' : 'connecting', null);
    const next = deps.createClient({
      onChange: scheduleSnapshot,
      onClose: () => {
        if (client !== next) return;
        client = null;
        log('Lost the connection to Streamlabs. Retrying…', 'bad');
        cb.onPhase('retrying', null);
        void reportState(false);
        scheduleRetry();
      },
    });
    try {
      await next.connect(token);
    } catch (err) {
      const e = err as StreamlabsError;
      if (!wanted) return;
      if (e.code === 'auth') {
        // Same token, same answer: wait for the streamer to paste a new one.
        wanted = false;
        cb.onPhase('error', e.message);
      } else {
        cb.onPhase(isRetry ? 'retrying' : 'error', e.message);
        scheduleRetry();
      }
      if (!isRetry) void reportState(false);
      return;
    }
    if (!wanted) {
      next.close();
      return;
    }
    client = next;
    cb.onPhase('connected', null);
    log('Connected to Streamlabs.', 'ok');
    await pushSnapshot();
    await claim();
  }

  /** Disconnect. `report` tells broadside Streamlabs is no longer reachable. */
  function stop(report = true) {
    wanted = false;
    if (retryTimer) clearTimeout(retryTimer);
    if (snapshotTimer) clearTimeout(snapshotTimer);
    retryTimer = snapshotTimer = null;
    const had = client;
    client = null;
    had?.close();
    cb.onPhase('idle', null);
    if (report && had) void reportState(false);
  }

  return {
    /** Connect with this token, retrying on drops until stop(). */
    start(newToken: string) {
      stop(false);
      token = newToken;
      wanted = true;
      void open(false);
    },
    stop,
    claim,
    /** The periodic check-in that keeps the relay counted as online. */
    heartbeat() {
      return reportState(client !== null);
    },
    get connected() {
      return client !== null;
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;
