/**
 * Lightweight fake plugin host for unit-testing server.ts without a live BB
 * server.  Mirrors the @bb/plugin-sdk/testing surface (createFakePluginHost)
 * with only the features this plugin exercises (rpc, settings, sdk.projects,
 * sdk.system, hosts.execute, log, onDispose).
 *
 * This file is purely test infrastructure — it never touches bd or the
 * filesystem.
 */

import type {
  BbPluginApi,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@bb/plugin-sdk";

/* ── types ─────────────────────────────────────────────────────────────────── */

interface FakeLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

interface FakePluginRegistrations {
  settingsDescriptors: PluginSettingDescriptors;
  rpcContract: unknown;
  rpcHandlers: Record<string, (...args: any[]) => any>;
  rpcMethods: string[];
}

export interface FakePluginHarness {
  readonly logEntries: FakeLogEntry[];
  readonly registrations: FakePluginRegistrations;
  /** Invoke a registered RPC method by name. */
  callRpc(method: string, input?: unknown): Promise<unknown>;
  /** Simulate a settings save and fire onChange. */
  setSettings(values: Record<string, PluginSettingValue | null>): Promise<void>;
  dispose(): Promise<void>;
}

/* ── factory ───────────────────────────────────────────────────────────────── */

export interface CreateFakePluginHostOptions {
  pluginId?: string;
  /** Pre-seeded stored settings. */
  settings?: Record<string, PluginSettingValue>;
  /** Deterministic host command executor (replaces bb.hosts.execute). */
  hostCommandExecutor?: (
    request: { hostId?: string; command: string; args: readonly string[]; cwd: string; timeoutMs?: number },
  ) => Promise<{
    status: "exited" | "spawn_error" | "timed_out" | "output_limit";
    exitCode: number | null;
    stdout: string;
    stderr: string;
    errorCode: string | null;
    error: string | null;
  }>;
  /** Default workspace path returned by settings.get(). */
  workspacePath?: string;
  /** Project sources returned by bb.sdk.projects.get(). */
  projectSources?: Array<Record<string, unknown>>;
  /** Primary host id returned by bb.sdk.system.config(). */
  primaryHostId?: string | null;
}

export function createFakePluginHost(options: CreateFakePluginHostOptions = {}) {
  const pluginId = options.pluginId ?? "test-plugin";
  const storedSettings: Record<string, PluginSettingValue> = {
    ...(options.workspacePath !== undefined
      ? { workspacePath: options.workspacePath }
      : {}),
    ...options.settings,
  };

  let onChangeListeners: Array<
    (values: Record<string, PluginSettingValue>) => void
  > = [];

  const logEntries: FakeLogEntry[] = [];
  const registrations: FakePluginRegistrations = {
    settingsDescriptors: {},
    rpcContract: null,
    rpcHandlers: {},
    rpcMethods: [],
  };
  const disposeHooks: Array<() => void> = [];
  let disposed = false;

  function checkDisposed() {
    if (disposed) {
      throw Object.assign(new Error(`${pluginId} context is stale`), {
        name: "PluginContextStaleError",
      });
    }
  }

  const hostExecute =
    options.hostCommandExecutor ??
    (async () => {
      throw new Error("host executor not configured");
    });

  const sdkOverrides = options;

  const bb: BbPluginApi = {
    log: {
      debug: (...args: unknown[]) =>
        logEntries.push({ level: "debug", message: String(args[0]) }),
      info: (...args: unknown[]) =>
        logEntries.push({ level: "info", message: String(args[0]) }),
      warn: (...args: unknown[]) =>
        logEntries.push({ level: "warn", message: String(args[0]) }),
      error: (...args: unknown[]) =>
        logEntries.push({ level: "error", message: String(args[0]) }),
    },
    settings: {
      define: (descriptors: PluginSettingDescriptors) => {
        registrations.settingsDescriptors = descriptors;
        return {
          get: async () => {
            checkDisposed();
            const values: Record<string, PluginSettingValue> = {};
            for (const [key, desc] of Object.entries(descriptors)) {
              values[key] =
                storedSettings[key] !== undefined
                  ? storedSettings[key]
                  : desc.default ?? null;
            }
            return values;
          },
          onChange: (fn: (values: Record<string, PluginSettingValue>) => void) => {
            onChangeListeners.push(fn);
          },
        };
      },
    },
    rpc: {
      register: (
        contract: unknown,
        handlers: Record<string, (...args: any[]) => any>,
      ) => {
        checkDisposed();
        registrations.rpcContract = contract;
        registrations.rpcHandlers = handlers;
        registrations.rpcMethods = Object.keys(handlers);
      },
    },
    sdk: {
      projects: {
        get: async () => {
          checkDisposed();
          return {
            id: "proj-test",
            name: "Test project",
            sources: sdkOverrides.projectSources ?? [],
          };
        },
        list: async () => [],
      },
      system: {
        config: async () => {
          checkDisposed();
          return {
            primaryHostId: sdkOverrides.primaryHostId ?? "host-primary",
          };
        },
      },
    } as BbPluginApi["sdk"],
    hosts: {
      execute: async (request: PluginHostCommandRequest) => {
        checkDisposed();
        return hostExecute(request);
      },
    },
    server: {
      loopbackBaseUrl: "http://127.0.0.1:38886",
    },
    onDispose: (fn: () => void) => {
      checkDisposed();
      disposeHooks.push(fn);
    },
  } as unknown as BbPluginApi;

  const harness: FakePluginHarness = {
    get logEntries() {
      return logEntries;
    },
    get registrations() {
      return registrations;
    },
    async callRpc(method: string, input?: unknown) {
      checkDisposed();
      const handler = registrations.rpcHandlers[method];
      if (!handler) {
        throw new Error(`RPC method not found: ${method}`);
      }
      return handler(input ?? {});
    },
    async setSettings(values: Record<string, PluginSettingValue | null>) {
      checkDisposed();
      for (const [key, value] of Object.entries(values)) {
        if (value === null) {
          delete storedSettings[key];
        } else {
          storedSettings[key] = value;
        }
      }
      const current = await (bb.settings as any).define({}).get();
      for (const fn of onChangeListeners) {
        fn(current);
      }
    },
    async dispose() {
      disposed = true;
      for (const fn of disposeHooks) {
        try {
          fn();
        } catch {
          // isolated dispose
        }
      }
    },
  };

  return { bb, harness };
}
