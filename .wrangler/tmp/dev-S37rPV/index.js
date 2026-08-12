var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context2, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context2.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context2, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context2.error = err;
            res = await onError(err, context2);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context2.finalized === false && onNotFound) {
          res = await onNotFound(context2);
        }
      }
      if (res && (context2.finalized === false || isError)) {
        context2.res = res;
      }
      return context2;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
}, "bufferToFormData");

// node_modules/hono/dist/utils/body.js
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context2, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context: context2 }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context2, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env2, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env2, "GET")))();
    }
    const path = this.getPath(request, { env: env2 });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env: env2,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context2 = await composed(c);
        if (!context2.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context2.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context2, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context2.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context2, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const opts = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// workers/env.js
var DEFAULT_SETTINGS = {
  publicBaseUrl: "",
  inworldApiKey: "",
  inworldLlmModel: "",
  inworldSttModel: "",
  inworldSttLanguage: "",
  qwenApiKey: "",
  qwenModel: "",
  openrouterApiKey: "",
  openrouterBuzzinModel: ""
};
var SETTINGS_KEY = "app-settings";
function maskApiKey(key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return `\u2022\u2022\u2022\u2022${trimmed.slice(-4)}`;
}
__name(maskApiKey, "maskApiKey");
function normalizePublicBaseUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error("URL must start with http:// or https://");
  }
  return trimmed;
}
__name(normalizePublicBaseUrl, "normalizePublicBaseUrl");
async function readSettings(env2) {
  const raw2 = await env2.SETTINGS.get(SETTINGS_KEY, "json");
  if (!raw2 || typeof raw2 !== "object") return { ...DEFAULT_SETTINGS };
  return {
    publicBaseUrl: typeof raw2.publicBaseUrl === "string" ? raw2.publicBaseUrl.trim().replace(/\/$/, "") : "",
    inworldApiKey: typeof raw2.inworldApiKey === "string" ? raw2.inworldApiKey.trim() : "",
    inworldLlmModel: typeof raw2.inworldLlmModel === "string" ? raw2.inworldLlmModel.trim() : "",
    inworldSttModel: typeof raw2.inworldSttModel === "string" ? raw2.inworldSttModel.trim() : "",
    inworldSttLanguage: typeof raw2.inworldSttLanguage === "string" ? raw2.inworldSttLanguage.trim() : "",
    qwenApiKey: typeof raw2.qwenApiKey === "string" ? raw2.qwenApiKey.trim() : "",
    qwenModel: typeof raw2.qwenModel === "string" ? raw2.qwenModel.trim() : "",
    openrouterApiKey: typeof raw2.openrouterApiKey === "string" ? raw2.openrouterApiKey.trim() : "",
    openrouterBuzzinModel: typeof raw2.openrouterBuzzinModel === "string" ? raw2.openrouterBuzzinModel.trim() : ""
  };
}
__name(readSettings, "readSettings");
async function writeSettings(env2, partial) {
  const current = await readSettings(env2);
  const next = { ...current, ...partial };
  if (typeof next.publicBaseUrl === "string") {
    next.publicBaseUrl = next.publicBaseUrl.trim().replace(/\/$/, "");
  }
  for (const key of [
    "inworldApiKey",
    "inworldLlmModel",
    "inworldSttModel",
    "inworldSttLanguage",
    "qwenApiKey",
    "qwenModel",
    "openrouterApiKey",
    "openrouterBuzzinModel"
  ]) {
    if (typeof next[key] === "string") next[key] = next[key].trim();
  }
  await env2.SETTINGS.put(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
__name(writeSettings, "writeSettings");
async function getPublicBaseUrl(env2) {
  const saved = (await readSettings(env2)).publicBaseUrl;
  return saved || String(env2.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}
__name(getPublicBaseUrl, "getPublicBaseUrl");
async function getInworldApiKey(env2) {
  const saved = (await readSettings(env2)).inworldApiKey;
  return saved || String(env2.INWORLD_API_KEY || "").trim();
}
__name(getInworldApiKey, "getInworldApiKey");
async function getInworldLlmModel(env2) {
  const saved = (await readSettings(env2)).inworldLlmModel;
  return saved || String(env2.INWORLD_LLM_MODEL || "auto").trim() || "auto";
}
__name(getInworldLlmModel, "getInworldLlmModel");
async function getInworldSttModel(env2) {
  const saved = (await readSettings(env2)).inworldSttModel;
  return saved || String(env2.INWORLD_STT_MODEL || "inworld/inworld-stt-1").trim();
}
__name(getInworldSttModel, "getInworldSttModel");
async function getInworldSttLanguage(env2) {
  const saved = (await readSettings(env2)).inworldSttLanguage;
  return saved || String(env2.INWORLD_STT_LANGUAGE || "en").trim() || "en";
}
__name(getInworldSttLanguage, "getInworldSttLanguage");
async function getQwenApiKey(env2) {
  const saved = (await readSettings(env2)).qwenApiKey;
  return saved || String(env2.QWEN_API_KEY || "").trim();
}
__name(getQwenApiKey, "getQwenApiKey");
async function getQwenModel(env2) {
  const saved = (await readSettings(env2)).qwenModel;
  return saved || String(env2.QWEN_MODEL || "qwen-plus").trim() || "qwen-plus";
}
__name(getQwenModel, "getQwenModel");
async function getOpenRouterApiKey(env2) {
  const saved = (await readSettings(env2)).openrouterApiKey;
  return saved || String(env2.OPENROUTER_API_KEY || "").trim();
}
__name(getOpenRouterApiKey, "getOpenRouterApiKey");
async function getOpenRouterBuzzinModel(env2) {
  const saved = (await readSettings(env2)).openrouterBuzzinModel;
  return saved || String(env2.OPENROUTER_BUZZIN_MODEL || "mistralai/voxtral-small-24b-2507").trim();
}
__name(getOpenRouterBuzzinModel, "getOpenRouterBuzzinModel");
async function buildConfigResponse(env2, scoreStats) {
  const settings = await readSettings(env2);
  const effectiveInworldKey = await getInworldApiKey(env2);
  const effectiveInworldLlmModel = await getInworldLlmModel(env2);
  const publicBaseUrl = await getPublicBaseUrl(env2);
  return {
    publicBaseUrl: settings.publicBaseUrl || "",
    envDefault: String(env2.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    effectivePublicBaseUrl: publicBaseUrl,
    inworldApiKeySaved: !!settings.inworldApiKey,
    inworldEnvDefaultConfigured: !!env2.INWORLD_API_KEY,
    inworldApiKeyConfigured: !!effectiveInworldKey,
    inworldApiKeyMasked: maskApiKey(effectiveInworldKey),
    inworldLlmModelSaved: settings.inworldLlmModel || "",
    inworldLlmModelEnvDefault: String(env2.INWORLD_LLM_MODEL || "auto"),
    effectiveInworldLlmModel,
    inworldSttModelSaved: settings.inworldSttModel || "",
    inworldSttModelEnvDefault: String(env2.INWORLD_STT_MODEL || "inworld/inworld-stt-1"),
    effectiveInworldSttModel: await getInworldSttModel(env2),
    inworldSttLanguageSaved: settings.inworldSttLanguage || "",
    inworldSttLanguageEnvDefault: String(env2.INWORLD_STT_LANGUAGE || "en"),
    effectiveInworldSttLanguage: await getInworldSttLanguage(env2),
    qwenApiKeySaved: !!settings.qwenApiKey,
    qwenEnvDefaultConfigured: !!env2.QWEN_API_KEY,
    qwenApiKeyConfigured: !!await getQwenApiKey(env2),
    qwenApiKeyMasked: maskApiKey(await getQwenApiKey(env2)),
    qwenModelSaved: settings.qwenModel || "",
    qwenModelEnvDefault: String(env2.QWEN_MODEL || "qwen-plus"),
    effectiveQwenModel: await getQwenModel(env2),
    openrouterApiKeySaved: !!settings.openrouterApiKey,
    openrouterEnvDefaultConfigured: !!env2.OPENROUTER_API_KEY,
    openrouterApiKeyConfigured: !!await getOpenRouterApiKey(env2),
    openrouterApiKeyMasked: maskApiKey(await getOpenRouterApiKey(env2)),
    openrouterBuzzinModelSaved: settings.openrouterBuzzinModel || "",
    openrouterBuzzinModelEnvDefault: String(
      env2.OPENROUTER_BUZZIN_MODEL || "mistralai/voxtral-small-24b-2507"
    ),
    effectiveOpenRouterBuzzinModel: await getOpenRouterBuzzinModel(env2),
    notificationPreview: {
      session_id: "123456",
      class_name: "Example class",
      teacher_name: "Example teacher",
      base_endpoint: publicBaseUrl
    },
    studentDatabase: scoreStats
  };
}
__name(buildConfigResponse, "buildConfigResponse");
async function buildNotificationData(env2, extra = {}) {
  return {
    ...extra,
    base_endpoint: await getPublicBaseUrl(env2)
  };
}
__name(buildNotificationData, "buildNotificationData");

// workers/auth.js
function pickToken(req) {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return auth.trim() || null;
}
__name(pickToken, "pickToken");
function pickTeacherId(req) {
  const header = req.headers.get("x-teacher-id");
  const raw2 = header;
  const id = Number(raw2);
  return Number.isInteger(id) && id > 0 ? id : null;
}
__name(pickTeacherId, "pickTeacherId");
async function requireCmsAuth(req, env2) {
  const token = pickToken(req);
  if (!token) return { error: { status: 401, message: "Missing auth token." } };
  const teacherId = pickTeacherId(req);
  if (!teacherId) return { error: { status: 400, message: "Missing teacher id." } };
  const { ok } = await langoRequest(env2, "GET", "/whiteboard/classList", { token });
  if (!ok) return { error: { status: 401, message: "Invalid or expired token." } };
  return { token, teacherId };
}
__name(requireCmsAuth, "requireCmsAuth");
async function langoRequest(env2, method, endpoint, { token, body } = {}) {
  const base = String(env2.LANGO_API_BASE || "https://dev.api.lango.ai/v1");
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers,
    body: body !== void 0 ? JSON.stringify(body) : void 0
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  return { ok: res.ok, status: res.status, data };
}
__name(langoRequest, "langoRequest");

// workers/stores/cms-d1.js
function nextCourseId(rows) {
  const ids = rows.map((r) => r.id).filter((id) => typeof id === "number");
  const minId = ids.length ? Math.min(...ids) : 0;
  return minId <= 0 ? minId - 1 : -1;
}
__name(nextCourseId, "nextCourseId");
function nextSectionId(sections) {
  const ids = (sections || []).map((s) => s.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}
__name(nextSectionId, "nextSectionId");
function nextExerciseId(sections) {
  const ids = flattenExercises({ sections }).map((e) => e.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}
__name(nextExerciseId, "nextExerciseId");
function flattenExercises(course) {
  const sections = course?.sections || [];
  const exercises = [];
  for (const section of sections) {
    for (const exercise of section.exercises || []) {
      exercises.push(exercise);
    }
  }
  return exercises;
}
__name(flattenExercises, "flattenExercises");
function migrateLegacyExercises(course) {
  if (Array.isArray(course.sections)) {
    delete course.exercises;
    return course;
  }
  const legacy = Array.isArray(course.exercises) ? course.exercises : [];
  if (!legacy.length) {
    course.sections = [];
    delete course.exercises;
    return course;
  }
  const ordered = [...legacy].sort((a, b) => (a.order || 0) - (b.order || 0));
  const sectionOrder = [];
  const sectionMap = /* @__PURE__ */ new Map();
  for (const ex of ordered) {
    const title2 = String(ex.section || "Exercises").trim().slice(0, 120) || "Exercises";
    if (!sectionMap.has(title2)) {
      sectionMap.set(title2, {
        id: sectionOrder.length + 1,
        title: title2,
        order: sectionOrder.length + 1,
        exercises: []
      });
      sectionOrder.push(title2);
    }
    const { section: _s, order: _o, ...rest } = ex;
    sectionMap.get(title2).exercises.push(rest);
  }
  course.sections = sectionOrder.map((title2) => sectionMap.get(title2));
  delete course.exercises;
  return course;
}
__name(migrateLegacyExercises, "migrateLegacyExercises");
function normalizeBuzzinQuestionText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.text || value.question || value.title || "").trim();
  }
  return String(value).trim();
}
__name(normalizeBuzzinQuestionText, "normalizeBuzzinQuestionText");
function collectBuzzinQuestionsFromRaw(raw2) {
  const items = Array.isArray(raw2?.items) ? raw2.items : [];
  const first = items[0] || {};
  const fromFirstItem = (first.questions || []).map(normalizeBuzzinQuestionText).filter(Boolean);
  if (fromFirstItem.length) return fromFirstItem;
  const fromExtraItems = items.slice(1).map((item) => normalizeBuzzinQuestionText(item?.question || item?.text || item?.title)).filter(Boolean);
  if (fromExtraItems.length) return fromExtraItems;
  const topLevel = (raw2?.questions || []).map(normalizeBuzzinQuestionText).filter(Boolean);
  if (topLevel.length) return topLevel;
  return [];
}
__name(collectBuzzinQuestionsFromRaw, "collectBuzzinQuestionsFromRaw");
function ensureSingleCorrectOption(options) {
  if (!Array.isArray(options) || !options.length) return [];
  const firstCorrectIdx = options.findIndex((o) => o.isCorrect);
  const correctIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
  return options.map((o, i) => ({ ...o, isCorrect: i === correctIdx }));
}
__name(ensureSingleCorrectOption, "ensureSingleCorrectOption");
function normalizeExercise(raw2, order) {
  const type = String(raw2.type || "mcquiz").toLowerCase();
  const base = {
    id: raw2.id,
    title: String(raw2.title || "Untitled exercise").trim().slice(0, 200),
    subTitle: String(raw2.subTitle || "").trim().slice(0, 120),
    order: order ?? raw2.order ?? 1,
    type,
    items: []
  };
  if (type === "video") {
    const url = String(raw2.items?.[0]?.videoUrl || raw2.videoUrl || "").trim().slice(0, 500);
    base.subTitle = base.subTitle || "Video";
    base.items = url ? [{ videoUrl: url }] : [];
  } else if (type === "buzzin") {
    const item = raw2.items?.[0] || raw2;
    const legacyQuestion = collectBuzzinQuestionsFromRaw(raw2)[0] || "";
    const topic = String(item.topic || legacyQuestion || item.title || raw2.title || "").trim().slice(0, 500);
    const sttLanguage = String(item.sttLanguage || raw2.sttLanguage || "").trim().toLowerCase().split("-")[0].slice(0, 8);
    base.subTitle = base.subTitle || "Buzz In";
    base.items = topic ? [{ topic, ...sttLanguage ? { sttLanguage } : {} }] : [];
  } else {
    const isFastMc = type === "fastmcquiz";
    base.type = isFastMc ? "fastmcquiz" : "mcquiz";
    base.subTitle = base.subTitle || (isFastMc ? "Fast MC Quiz" : "MC Quiz");
    base.items = (raw2.items || []).map((item, idx) => {
      const options = ensureSingleCorrectOption(
        (item.options || []).slice(0, 6).map((o) => ({
          text: String(o.text || "").trim().slice(0, 200),
          isCorrect: !!o.isCorrect
        })).filter((o) => o.text)
      );
      const image = String(item.image || item.imageUrl || "").trim().slice(0, 500);
      return {
        title: String(item.title || item.question || `Question ${idx + 1}`).trim().slice(0, 500),
        options,
        timeLimit: Math.min(60, Math.max(5, Number(item.timeLimit) || 15)),
        image: image || null
      };
    }).filter((item) => item.title && item.options.length >= 2).slice(0, 30);
  }
  return base;
}
__name(normalizeExercise, "normalizeExercise");
function normalizeSection(raw2, order) {
  const sortedExercises = [...raw2.exercises || []].sort((a, b) => (a.order || 0) - (b.order || 0));
  const exercises = sortedExercises.map((exercise, i) => normalizeExercise(exercise, i + 1));
  return {
    id: raw2.id,
    title: String(raw2.title || `Section ${order}`).trim().slice(0, 120),
    banner: String(raw2.banner || "").trim().slice(0, 500),
    order: order ?? raw2.order ?? 1,
    exercises
  };
}
__name(normalizeSection, "normalizeSection");
function normalizeCourse(course) {
  if (!course) return course;
  migrateLegacyExercises(course);
  const sortedSections = [...course.sections || []].sort((a, b) => (a.order || 0) - (b.order || 0));
  course.sections = sortedSections.map((section, i) => normalizeSection(section, i + 1));
  return course;
}
__name(normalizeCourse, "normalizeCourse");
function normalizeClassIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
}
__name(normalizeClassIds, "normalizeClassIds");
function courseMatchesClass(course, classId) {
  if (classId == null || classId === "") return true;
  const ids = normalizeClassIds(course.classIds);
  return ids.length === 0 || ids.includes(Number(classId));
}
__name(courseMatchesClass, "courseMatchesClass");
async function readAllCourses(db) {
  const { results } = await db.prepare("SELECT id, teacher_id, data FROM courses").all();
  return (results || []).map((row) => {
    try {
      const course = JSON.parse(row.data);
      course.id = row.id;
      course.teacherId = row.teacher_id;
      return course;
    } catch {
      return null;
    }
  }).filter(Boolean);
}
__name(readAllCourses, "readAllCourses");
async function writeCourse(db, course) {
  await db.prepare(
    "INSERT INTO courses (id, teacher_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(
    course.id,
    course.teacherId,
    JSON.stringify(course),
    course.createdAt,
    course.updatedAt
  ).run();
}
__name(writeCourse, "writeCourse");
async function listCoursesForTeacher(db, teacherId, { classId } = {}) {
  const courses = await readAllCourses(db);
  return courses.filter((c) => c.teacherId === teacherId).map((course) => normalizeCourse({ ...course })).filter((c) => courseMatchesClass(c, classId)).map(({ sections, exercises: _e, ...course }) => ({
    ...course,
    classIds: normalizeClassIds(course.classIds),
    exerciseCount: flattenExercises({ sections }).length
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
__name(listCoursesForTeacher, "listCoursesForTeacher");
async function getCourseForTeacher(db, courseId, teacherId) {
  const row = await db.prepare("SELECT data FROM courses WHERE id = ? AND teacher_id = ?").bind(courseId, teacherId).first();
  if (!row) return null;
  try {
    const course = JSON.parse(row.data);
    return normalizeCourse(course);
  } catch {
    return null;
  }
}
__name(getCourseForTeacher, "getCourseForTeacher");
async function createCourse(db, teacherId, payload) {
  const courses = await readAllCourses(db);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const course = {
    id: nextCourseId(courses),
    teacherId,
    name: String(payload.name || "Untitled course").trim().slice(0, 120),
    description: String(payload.description || "").trim().slice(0, 500),
    banner: String(payload.banner || "").trim().slice(0, 500),
    langCode: String(payload.langCode || "en").trim().slice(0, 8),
    classIds: normalizeClassIds(payload.classIds),
    sections: [{ id: 1, title: "Section 1", order: 1, exercises: [] }],
    createdAt: now,
    updatedAt: now
  };
  await writeCourse(db, course);
  return course;
}
__name(createCourse, "createCourse");
async function updateCourse(db, courseId, teacherId, payload) {
  const course = await getCourseForTeacher(db, courseId, teacherId);
  if (!course) return null;
  normalizeCourse(course);
  if (payload.name != null) course.name = String(payload.name).trim().slice(0, 120);
  if (payload.description != null) course.description = String(payload.description).trim().slice(0, 500);
  if (payload.banner != null) course.banner = String(payload.banner).trim().slice(0, 500);
  if (payload.langCode != null) course.langCode = String(payload.langCode).trim().slice(0, 8);
  if (payload.classIds != null) course.classIds = normalizeClassIds(payload.classIds);
  course.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  delete course.exercises;
  await writeCourse(db, course);
  return normalizeCourse({ ...course });
}
__name(updateCourse, "updateCourse");
async function deleteCourse(db, courseId, teacherId) {
  const result = await db.prepare("DELETE FROM courses WHERE id = ? AND teacher_id = ?").bind(courseId, teacherId).run();
  return result.meta.changes > 0;
}
__name(deleteCourse, "deleteCourse");
async function updateSectionBanner(db, courseId, teacherId, sectionId, bannerUrl) {
  const course = await getCourseForTeacher(db, courseId, teacherId);
  if (!course) return null;
  const sectionIdx = course.sections.findIndex((s) => s.id === sectionId);
  if (sectionIdx < 0) return null;
  const oldBanner = course.sections[sectionIdx].banner || "";
  course.sections[sectionIdx].banner = String(bannerUrl || "").trim().slice(0, 500);
  course.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeCourse(db, course);
  return {
    section: { ...course.sections[sectionIdx] },
    oldBanner,
    updatedAt: course.updatedAt
  };
}
__name(updateSectionBanner, "updateSectionBanner");
async function saveSections(db, courseId, teacherId, sectionsPayload) {
  const course = await getCourseForTeacher(db, courseId, teacherId);
  if (!course) return null;
  let nextSection = nextSectionId([]);
  let nextExercise = nextExerciseId(course.sections || []);
  const sections = (sectionsPayload || []).map((rawSection, sectionIndex) => {
    const section = normalizeSection(rawSection, sectionIndex + 1);
    if (typeof rawSection.id === "number") {
      section.id = rawSection.id;
      nextSection = Math.max(nextSection, rawSection.id + 1);
    } else {
      section.id = nextSection;
      nextSection += 1;
    }
    section.order = sectionIndex + 1;
    section.exercises = (rawSection.exercises || []).map((rawExercise, exerciseIndex) => {
      const exercise = normalizeExercise(rawExercise, exerciseIndex + 1);
      if (typeof rawExercise.id === "number") {
        exercise.id = rawExercise.id;
        nextExercise = Math.max(nextExercise, rawExercise.id + 1);
      } else {
        exercise.id = nextExercise;
        nextExercise += 1;
      }
      exercise.order = exerciseIndex + 1;
      return exercise;
    });
    return section;
  });
  course.sections = sections;
  delete course.exercises;
  course.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeCourse(db, course);
  return normalizeCourse({ ...course });
}
__name(saveSections, "saveSections");
function courseDetailResponse(course) {
  if (!course) return null;
  const normalized = normalizeCourse({ ...course });
  return {
    success: true,
    course: {
      id: normalized.id,
      name: normalized.name,
      banner: normalized.banner || null,
      langCode: normalized.langCode || "en",
      description: normalized.description || "",
      classIds: normalizeClassIds(normalized.classIds),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt
    },
    sections: (normalized.sections || []).map((section) => ({
      ...section,
      exercises: (section.exercises || []).map((exercise) => ({ ...exercise }))
    }))
  };
}
__name(courseDetailResponse, "courseDetailResponse");

// workers/stores/score-d1.js
function studentKey(teacherId, classId, studentUserId) {
  return `${Number(teacherId)}:${Number(classId)}:${String(studentUserId)}`;
}
__name(studentKey, "studentKey");
function recordKey(teacherId, classId, roomId, exerciseId, studentUserId) {
  return `${Number(teacherId)}:${Number(classId)}:${String(roomId)}:${Number(exerciseId)}:${String(studentUserId)}`;
}
__name(recordKey, "recordKey");
async function totalsFromRecords(db, teacherId, classId, studentUserId) {
  const { results } = await db.prepare(
    "SELECT score, saved_at FROM score_records WHERE teacher_id = ? AND class_id = ? AND student_user_id = ?"
  ).bind(Number(teacherId), Number(classId), String(studentUserId)).all();
  let totalScore = 0;
  let exerciseCount = 0;
  let firstScoreAt = null;
  let lastScoreAt = null;
  for (const record of results || []) {
    totalScore += Math.max(0, Number(record.score) || 0);
    exerciseCount += 1;
    if (!firstScoreAt || record.saved_at < firstScoreAt) firstScoreAt = record.saved_at;
    if (!lastScoreAt || record.saved_at > lastScoreAt) lastScoreAt = record.saved_at;
  }
  return { totalScore, exerciseCount, firstScoreAt, lastScoreAt };
}
__name(totalsFromRecords, "totalsFromRecords");
async function saveExerciseScores(db, {
  teacherId,
  classId,
  courseId,
  exerciseId,
  exerciseTitle,
  exerciseType,
  roomId,
  scores
}) {
  if (!teacherId || !classId || !exerciseId || !roomId || !Array.isArray(scores)) {
    return { saved: 0, skipped: 0, error: "Missing required fields." };
  }
  let saved = 0;
  let skipped = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const entry of scores) {
    const studentUserId = String(entry.studentUserId || "").trim();
    if (!studentUserId) {
      skipped += 1;
      continue;
    }
    const key = recordKey(teacherId, classId, roomId, exerciseId, studentUserId);
    const existing = await db.prepare("SELECT record_key FROM score_records WHERE record_key = ?").bind(key).first();
    if (existing) {
      skipped += 1;
      continue;
    }
    const displayName = String(entry.displayName || "").trim().slice(0, 80);
    const score = Math.max(0, Number(entry.score) || 0);
    await db.prepare(
      "INSERT INTO score_records (record_key, teacher_id, class_id, course_id, exercise_id, exercise_title, exercise_type, room_id, student_user_id, display_name, score, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      key,
      Number(teacherId),
      Number(classId),
      courseId != null ? Number(courseId) : null,
      Number(exerciseId),
      String(exerciseTitle || "").slice(0, 120),
      String(exerciseType || "mcquiz").slice(0, 40),
      String(roomId),
      studentUserId,
      displayName,
      score,
      now
    ).run();
    const sKey = studentKey(teacherId, classId, studentUserId);
    const existingStudent = await db.prepare("SELECT * FROM score_students WHERE student_key = ?").bind(sKey).first();
    if (existingStudent) {
      await db.prepare(
        "UPDATE score_students SET display_name = ?, total_score = total_score + ?, exercise_count = exercise_count + 1, last_score_at = ?, updated_at = ? WHERE student_key = ?"
      ).bind(
        displayName || existingStudent.display_name,
        score,
        now,
        now,
        sKey
      ).run();
    } else {
      await db.prepare(
        "INSERT INTO score_students (student_key, teacher_id, class_id, student_user_id, display_name, total_score, exercise_count, first_score_at, last_score_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)"
      ).bind(sKey, Number(teacherId), Number(classId), studentUserId, displayName, score, now, now, now).run();
    }
    saved += 1;
  }
  return { saved, skipped };
}
__name(saveExerciseScores, "saveExerciseScores");
async function listScoresForClass(db, teacherId, classId, { courseId, exerciseId, roomId } = {}) {
  let query = "SELECT * FROM score_records WHERE teacher_id = ? AND class_id = ?";
  const binds = [Number(teacherId), Number(classId)];
  if (courseId != null) {
    query += " AND course_id = ?";
    binds.push(Number(courseId));
  }
  if (exerciseId != null) {
    query += " AND exercise_id = ?";
    binds.push(Number(exerciseId));
  }
  if (roomId) {
    query += " AND room_id = ?";
    binds.push(String(roomId));
  }
  query += " ORDER BY saved_at DESC";
  const { results } = await db.prepare(query).bind(...binds).all();
  return (results || []).map((r) => ({
    recordKey: r.record_key,
    teacherId: r.teacher_id,
    classId: r.class_id,
    courseId: r.course_id,
    exerciseId: r.exercise_id,
    exerciseTitle: r.exercise_title,
    exerciseType: r.exercise_type,
    roomId: r.room_id,
    studentUserId: r.student_user_id,
    displayName: r.display_name,
    score: r.score,
    savedAt: r.saved_at
  }));
}
__name(listScoresForClass, "listScoresForClass");
async function listStudentsForClass(db, teacherId, classId) {
  const { results } = await db.prepare(
    "SELECT * FROM score_students WHERE teacher_id = ? AND class_id = ? ORDER BY display_name"
  ).bind(Number(teacherId), Number(classId)).all();
  const students = [];
  for (const row of results || []) {
    const computed = await totalsFromRecords(db, teacherId, classId, row.student_user_id);
    students.push({
      teacherId: row.teacher_id,
      classId: row.class_id,
      studentUserId: row.student_user_id,
      displayName: row.display_name,
      totalScore: computed.totalScore,
      exerciseCount: computed.exerciseCount,
      firstScoreAt: computed.firstScoreAt,
      lastScoreAt: computed.lastScoreAt,
      updatedAt: row.updated_at
    });
  }
  return students;
}
__name(listStudentsForClass, "listStudentsForClass");
async function listSemesterTotalsForClass(db, teacherId, classId) {
  const students = await listStudentsForClass(db, teacherId, classId);
  return students.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return (a.displayName || "").localeCompare(b.displayName || "");
  });
}
__name(listSemesterTotalsForClass, "listSemesterTotalsForClass");
async function getStats(db) {
  const students = await db.prepare("SELECT COUNT(*) as count FROM score_students").first();
  const records = await db.prepare("SELECT COUNT(*) as count FROM score_records").first();
  return {
    studentCount: students?.count || 0,
    recordCount: records?.count || 0
  };
}
__name(getStats, "getStats");
async function clearAll(db) {
  const students = await db.prepare("SELECT COUNT(*) as count FROM score_students").first();
  const records = await db.prepare("SELECT COUNT(*) as count FROM score_records").first();
  await db.prepare("DELETE FROM score_students").run();
  await db.prepare("DELETE FROM score_records").run();
  return {
    students: students?.count || 0,
    records: records?.count || 0
  };
}
__name(clearAll, "clearAll");

// workers/stores/progress-d1.js
function progressKey(teacherId, classId, courseId) {
  return `${Number(teacherId)}:${Number(classId)}:${Number(courseId)}`;
}
__name(progressKey, "progressKey");
function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}
__name(normalizeIds, "normalizeIds");
function emptyProgress(teacherId, classId, courseId) {
  return {
    teacherId: Number(teacherId),
    classId: Number(classId),
    courseId: Number(courseId),
    completedExerciseIds: [],
    visitedSectionIds: [],
    lastSectionId: null,
    lastExerciseId: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(emptyProgress, "emptyProgress");
async function getProgress(db, teacherId, classId, courseId) {
  const key = progressKey(teacherId, classId, courseId);
  const row = await db.prepare("SELECT * FROM host_progress WHERE progress_key = ?").bind(key).first();
  if (!row) return emptyProgress(teacherId, classId, courseId);
  return {
    ...emptyProgress(teacherId, classId, courseId),
    completedExerciseIds: normalizeIds(JSON.parse(row.completed_exercise_ids || "[]")),
    visitedSectionIds: normalizeIds(JSON.parse(row.visited_section_ids || "[]")),
    lastSectionId: row.last_section_id ?? null,
    lastExerciseId: row.last_exercise_id ?? null,
    updatedAt: row.updated_at
  };
}
__name(getProgress, "getProgress");
async function upsertProgress(db, teacherId, classId, courseId, patch = {}) {
  const key = progressKey(teacherId, classId, courseId);
  const existing = await getProgress(db, teacherId, classId, courseId);
  if (patch.completedExerciseIds != null) {
    existing.completedExerciseIds = normalizeIds([
      ...existing.completedExerciseIds,
      ...patch.completedExerciseIds
    ]);
  }
  if (patch.visitedSectionIds != null) {
    existing.visitedSectionIds = normalizeIds([
      ...existing.visitedSectionIds,
      ...patch.visitedSectionIds
    ]);
  }
  if (patch.lastSectionId !== void 0) {
    existing.lastSectionId = patch.lastSectionId == null ? null : Number(patch.lastSectionId);
  }
  if (patch.lastExerciseId !== void 0) {
    existing.lastExerciseId = patch.lastExerciseId == null ? null : Number(patch.lastExerciseId);
  }
  existing.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare(
    "INSERT INTO host_progress (progress_key, teacher_id, class_id, course_id, completed_exercise_ids, visited_section_ids, last_section_id, last_exercise_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(progress_key) DO UPDATE SET completed_exercise_ids = excluded.completed_exercise_ids, visited_section_ids = excluded.visited_section_ids, last_section_id = excluded.last_section_id, last_exercise_id = excluded.last_exercise_id, updated_at = excluded.updated_at"
  ).bind(
    key,
    Number(teacherId),
    Number(classId),
    Number(courseId),
    JSON.stringify(existing.completedExerciseIds),
    JSON.stringify(existing.visitedSectionIds),
    existing.lastSectionId,
    existing.lastExerciseId,
    existing.updatedAt
  ).run();
  return getProgress(db, teacherId, classId, courseId);
}
__name(upsertProgress, "upsertProgress");

// shared/lib/lango-classes.js
var LEVEL_FIELDS = [
  "englishLevel",
  "english_level",
  "level",
  "grade",
  "year",
  "primaryLevel",
  "primary_level",
  "section"
];
function pickString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}
__name(pickString, "pickString");
function pickStudentCount(raw2) {
  if (Array.isArray(raw2.students)) return raw2.students.length;
  if (Array.isArray(raw2.studentList)) return raw2.studentList.length;
  if (Array.isArray(raw2.student_list)) return raw2.student_list.length;
  const count3 = raw2.student_count ?? raw2.studentCount ?? raw2.students_count ?? raw2.totalStudents ?? raw2.total_students ?? raw2.numStudents;
  if (count3 == null || count3 === "") return null;
  const n = Number(count3);
  return Number.isFinite(n) ? n : null;
}
__name(pickStudentCount, "pickStudentCount");
function normalizeStudent(raw2) {
  if (!raw2 || typeof raw2 !== "object") return null;
  const id = Number(raw2.id ?? raw2.student_id ?? raw2.studentId);
  if (!Number.isFinite(id)) return null;
  const firstName = pickString(raw2.firstName, raw2.first_name, raw2.givenName, raw2.given_name);
  const lastName = pickString(raw2.lastName, raw2.last_name, raw2.familyName, raw2.family_name);
  const fullName = pickString(raw2.fullName, raw2.full_name, raw2.name, `${firstName} ${lastName}`.trim()) || `Student ${id}`;
  return { id, firstName, lastName, fullName };
}
__name(normalizeStudent, "normalizeStudent");
function normalizeStudentList(raw2) {
  const list = raw2.studentList ?? raw2.student_list ?? raw2.students ?? [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeStudent).filter(Boolean);
}
__name(normalizeStudentList, "normalizeStudentList");
function pickLevel(raw2) {
  for (const field of LEVEL_FIELDS) {
    const value = raw2?.[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  const name = pickString(raw2?.name, raw2?.class_name, raw2?.className, raw2?.title);
  const levelMatch = name.match(/\b(P[1-6]|S[1-6])\b/i);
  if (levelMatch) return levelMatch[1].toUpperCase();
  return null;
}
__name(pickLevel, "pickLevel");
function normalizeClassItem(raw2) {
  if (!raw2 || typeof raw2 !== "object") return null;
  const id = Number(raw2.id ?? raw2.class_id ?? raw2.classId);
  if (!Number.isFinite(id)) return null;
  const name = pickString(raw2.name, raw2.class_name, raw2.className, raw2.title) || `Class ${id}`;
  const studentCount = pickStudentCount(raw2);
  const level = pickLevel(raw2);
  const studentList = normalizeStudentList(raw2);
  return {
    id,
    name,
    studentCount: studentCount ?? (studentList.length || null),
    studentList,
    englishLevel: level,
    level,
    grade: raw2.grade != null ? String(raw2.grade).trim() : null
  };
}
__name(normalizeClassItem, "normalizeClassItem");
function extractClassListPayload(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.classList)) return data.classList;
  if (Array.isArray(data.classes)) return data.classes;
  if (Array.isArray(data.data?.classList)) return data.data.classList;
  if (Array.isArray(data.data?.classes)) return data.data.classes;
  if (Array.isArray(data.result?.classList)) return data.result.classList;
  return [];
}
__name(extractClassListPayload, "extractClassListPayload");
function normalizeClassListResponse(data) {
  const rawList = extractClassListPayload(data);
  const classList = rawList.map(normalizeClassItem).filter(Boolean);
  return {
    ...data && typeof data === "object" && !Array.isArray(data) ? data : {},
    classList
  };
}
__name(normalizeClassListResponse, "normalizeClassListResponse");
function findStudentById(studentList, studentId) {
  const id = String(studentId ?? "").trim();
  if (!id) return null;
  return (Array.isArray(studentList) ? studentList : []).find(
    (student) => String(student.id) === id
  );
}
__name(findStudentById, "findStudentById");
function courseDisplayName(course) {
  return course?.name || course?.title || course?.courseName || "Whiteboard session";
}
__name(courseDisplayName, "courseDisplayName");
function courseBanner(course) {
  return course?.banner || course?.bannerUrl || course?.image || course?.thumbnail || course?.cover || "";
}
__name(courseBanner, "courseBanner");
function teacherDisplayName(user) {
  if (!user) return "Teacher";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.username || user.email || `User ${user.id}`;
}
__name(teacherDisplayName, "teacherDisplayName");
function normalizePin(pin) {
  return String(pin ?? "").trim().replace(/\D/g, "").slice(0, 6);
}
__name(normalizePin, "normalizePin");
function normalizeRoomId(roomId) {
  const id = normalizePin(roomId);
  return id.length === 6 ? id : null;
}
__name(normalizeRoomId, "normalizeRoomId");

// workers/services/ai.js
var INWORLD_API_BASE = "https://api.inworld.ai";
var INWORLD_BUZZIN_TTS_VOICE_ID = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
var INWORLD_TTS_MODEL_ID = "inworld-tts-1.5-max";
var OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
var TRANSCRIBE_DEFAULT_MODEL = "mistralai/voxtral-small-24b-2507";
var TRANSCRIBE_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
var TRANSCRIBE_PROMPT = "Listen to this audio and respond with exactly two sections:\n\nTranscript:\nWrite exactly what was spoken, verbatim. No extra commentary in this section.\n\nPronunciation feedback:\nComment on pronunciation quality. Note any mispronounced or unclear words, stress, rhythm, or intonation issues, and give brief constructive tips. If pronunciation is generally good, say so and mention any small improvements.";
async function parseInworldResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text || res.statusText };
  }
}
__name(parseInworldResponse, "parseInworldResponse");
function inworldErrorMessage(data, status) {
  return data?.message || data?.error?.message || `Inworld API returned ${status}.`;
}
__name(inworldErrorMessage, "inworldErrorMessage");
async function inworldTtsSynthesize(env2, text, voiceId = INWORLD_BUZZIN_TTS_VOICE_ID) {
  const key = await getInworldApiKey(env2);
  const trimmed = String(text || "").trim();
  if (!key) throw new Error("Inworld API key not configured.");
  if (!trimmed) throw new Error("No text to synthesize.");
  const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: trimmed,
      voiceId: String(voiceId || INWORLD_BUZZIN_TTS_VOICE_ID).trim() || INWORLD_BUZZIN_TTS_VOICE_ID,
      modelId: INWORLD_TTS_MODEL_ID,
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24e3 }
    })
  });
  const data = await parseInworldResponse(res);
  if (!res.ok) throw new Error(`TTS: ${inworldErrorMessage(data, res.status)}`);
  const audioContent = String(data?.audioContent || "").trim();
  if (!audioContent) throw new Error("TTS: No audio returned.");
  return { audioContent, format: "mp3" };
}
__name(inworldTtsSynthesize, "inworldTtsSynthesize");
async function parseOpenRouterResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text || res.statusText };
  }
}
__name(parseOpenRouterResponse, "parseOpenRouterResponse");
function openRouterErrorMessage(data, status) {
  const parts = [];
  const primary = data?.error?.message || data?.message;
  if (primary) parts.push(primary);
  if (data?.error?.metadata) parts.push(JSON.stringify(data.error.metadata));
  if (data?.error?.code) parts.push(`code: ${data.error.code}`);
  return parts.join(" \u2014 ") || `OpenRouter API returned ${status}.`;
}
__name(openRouterErrorMessage, "openRouterErrorMessage");
function extractOpenRouterMessageText(data) {
  const choices = data?.choices || [];
  if (!choices.length) return "";
  const content = choices[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === "text").map((part) => String(part.text || "").trim()).filter(Boolean).join(" ").trim();
  }
  return "";
}
__name(extractOpenRouterMessageText, "extractOpenRouterMessageText");
async function openRouterLlmComplete(env2, apiKey, model, messages, maxTokens = 256) {
  const key = String(apiKey || await getOpenRouterApiKey(env2) || "").trim();
  if (!key) throw new Error("OpenRouter is not configured. Add an API key in Config.");
  const llmModel = String(model || await getOpenRouterBuzzinModel(env2) || TRANSCRIBE_DEFAULT_MODEL).trim() || TRANSCRIBE_DEFAULT_MODEL;
  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": await getPublicBaseUrl(env2),
      "X-Title": "Lango Buzz In"
    },
    body: JSON.stringify({ model: llmModel, messages, max_tokens: maxTokens })
  });
  const data = await parseOpenRouterResponse(res);
  if (!res.ok) throw new Error(`LLM (${llmModel}): ${openRouterErrorMessage(data, res.status)}`);
  return extractOpenRouterMessageText(data);
}
__name(openRouterLlmComplete, "openRouterLlmComplete");
async function transcribeOpenRouterAudio(env2, { apiKey, model, audioBuffer, format, prompt, maxTokens = 1024 }) {
  const key = String(apiKey || await getOpenRouterApiKey(env2) || "").trim();
  if (!key) throw new Error("OpenRouter is not configured. Add an API key in Config.");
  const buzzinModel = String(model || await getOpenRouterBuzzinModel(env2) || TRANSCRIBE_DEFAULT_MODEL).trim() || TRANSCRIBE_DEFAULT_MODEL;
  const bytes = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
  if (!bytes.length) throw new Error("The selected audio file is empty.");
  if (bytes.length > TRANSCRIBE_MAX_AUDIO_BYTES) throw new Error("Audio file is too large (max 25 MB).");
  const audioFormat = String(format || "webm").trim().toLowerCase().replace(/^\./, "") || "webm";
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64Data = btoa(binary);
  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": await getPublicBaseUrl(env2),
      "X-Title": "OpenRouter Audio Transcribe"
    },
    body: JSON.stringify({
      model: buzzinModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: base64Data, format: audioFormat } },
            { type: "text", text: prompt }
          ]
        }
      ],
      max_tokens: maxTokens
    })
  });
  const data = await parseOpenRouterResponse(res);
  if (!res.ok) {
    const err = new Error(`Transcription (${buzzinModel}): ${openRouterErrorMessage(data, res.status)}`);
    err.openRouterDetails = data;
    throw err;
  }
  const text = extractOpenRouterMessageText(data);
  if (!text) throw new Error("Could not transcribe the audio. Try another file or model.");
  return text;
}
__name(transcribeOpenRouterAudio, "transcribeOpenRouterAudio");
async function inworldLlmComplete(env2, apiKey, model, messages, maxTokens = 256) {
  const llmModel = String(model || "auto").trim() || "auto";
  const res = await fetch(`${INWORLD_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: llmModel, messages, max_tokens: maxTokens })
  });
  const data = await parseInworldResponse(res);
  if (!res.ok) throw new Error(`LLM (${llmModel}): ${inworldErrorMessage(data, res.status)}`);
  return data?.choices?.[0]?.message?.content?.trim?.() || "";
}
__name(inworldLlmComplete, "inworldLlmComplete");
async function testInworldApiKey(env2, apiKey, llmModel) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("No Inworld API key to test.");
  const started = Date.now();
  const tts = await inworldTtsSynthesize(env2, "Inworld TTS is working.", INWORLD_BUZZIN_TTS_VOICE_ID);
  const llm = await inworldLlmComplete(env2, key, llmModel, [{ role: "user", content: "Reply with exactly: OK" }], 16);
  return {
    ok: true,
    latencyMs: Date.now() - started,
    tts: { ok: true, voiceId: INWORLD_BUZZIN_TTS_VOICE_ID, modelId: INWORLD_TTS_MODEL_ID },
    llm: { ok: true, model: llmModel || "auto", reply: llm.slice(0, 200) },
    stt: { ok: true, modelId: await getInworldSttModel(env2) }
  };
}
__name(testInworldApiKey, "testInworldApiKey");
async function testOpenRouterBuzzinModel(env2, apiKey, model) {
  const key = String(apiKey || await getOpenRouterApiKey(env2) || "").trim();
  if (!key) throw new Error("OpenRouter is not configured.");
  const buzzinModel = String(model || await getOpenRouterBuzzinModel(env2) || TRANSCRIBE_DEFAULT_MODEL).trim();
  const started = Date.now();
  const reply = await openRouterLlmComplete(env2, key, buzzinModel, [{ role: "user", content: "Reply with exactly: OK" }], 16);
  return { ok: true, model: buzzinModel, latencyMs: Date.now() - started, reply: reply.slice(0, 200) };
}
__name(testOpenRouterBuzzinModel, "testOpenRouterBuzzinModel");
async function testQwenApiKey(env2, apiKey, model) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("No Qwen API key to test.");
  const qwenModel = String(model || "qwen-plus").trim() || "qwen-plus";
  const base = String(env2.QWEN_API_BASE || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: qwenModel,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 16
    })
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new Error(data?.error?.message || data?.message || "Qwen API test failed.");
  return {
    ok: true,
    latencyMs: Date.now() - started,
    llm: { ok: true, model: qwenModel, reply: (data?.choices?.[0]?.message?.content || "").slice(0, 200) }
  };
}
__name(testQwenApiKey, "testQwenApiKey");
function audioFormatFromFilename(filename) {
  const match2 = String(filename || "").match(/\.([a-z0-9]+)$/i);
  return match2 ? match2[1].toLowerCase() : "webm";
}
__name(audioFormatFromFilename, "audioFormatFromFilename");

// workers/services/r2-uploads.js
var ALLOWED_IMAGE_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
function extFromMime(mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  return map[mime] || ".jpg";
}
__name(extFromMime, "extFromMime");
function uploadKeyFromUrl(url) {
  const path = String(url || "");
  if (!path.startsWith("/uploads/")) return null;
  return path.slice("/uploads/".length);
}
__name(uploadKeyFromUrl, "uploadKeyFromUrl");
async function uploadImage(env2, { prefix, ownerId, file }) {
  const mime = file.type || "";
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    throw new Error("Only JPEG, PNG, WebP, or GIF images are allowed.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Image must be 2 MB or smaller.");
  }
  const ext = extFromMime(mime);
  const key = `${prefix}/${ownerId}-${Date.now()}${ext}`;
  await env2.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: mime }
  });
  return `/uploads/${key}`;
}
__name(uploadImage, "uploadImage");
async function deleteUpload(env2, uploadUrl) {
  const key = uploadKeyFromUrl(uploadUrl);
  if (!key) return;
  try {
    await env2.UPLOADS.delete(key);
  } catch {
  }
}
__name(deleteUpload, "deleteUpload");
async function serveUpload(env2, pathname) {
  const key = uploadKeyFromUrl(pathname);
  if (!key) return null;
  const object = await env2.UPLOADS.get(key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000");
  return new Response(object.body, { headers });
}
__name(serveUpload, "serveUpload");
function parseMultipartFile(formData, fieldName) {
  const file = formData.get(fieldName);
  if (!file || typeof file === "string") return null;
  return file;
}
__name(parseMultipartFile, "parseMultipartFile");

// workers/routes/api.js
function sessionRoomStub(env2, roomId) {
  const id = env2.SESSION_ROOM.idFromName(String(roomId));
  return env2.SESSION_ROOM.get(id);
}
__name(sessionRoomStub, "sessionRoomStub");
function generateRoomId() {
  return String(Math.floor(1e5 + Math.random() * 9e5));
}
__name(generateRoomId, "generateRoomId");
function createApiApp() {
  const app = new Hono2();
  app.use("/api/*", cors());
  app.get("/api/config", async (c) => {
    const stats = await getStats(c.env.DB);
    return c.json(await buildConfigResponse(c.env, stats));
  });
  app.put("/api/config", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json();
    const updates = {};
    if (body.publicBaseUrl !== void 0) {
      try {
        updates.publicBaseUrl = body.publicBaseUrl == null || body.publicBaseUrl === "" ? "" : normalizePublicBaseUrl(body.publicBaseUrl);
      } catch (err) {
        return c.json({ message: err.message }, 400);
      }
    }
    for (const key of [
      "inworldApiKey",
      "inworldLlmModel",
      "inworldSttModel",
      "inworldSttLanguage",
      "qwenApiKey",
      "qwenModel",
      "openrouterApiKey",
      "openrouterBuzzinModel"
    ]) {
      if (body[key] !== void 0) updates[key] = String(body[key] || "").trim();
    }
    if (!Object.keys(updates).length) {
      return c.json({ message: "No settings to update." }, 400);
    }
    await writeSettings(c.env, updates);
    const stats = await getStats(c.env.DB);
    return c.json({ ok: true, ...await buildConfigResponse(c.env, stats) });
  });
  app.post("/api/config/test-inworld", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json().catch(() => ({}));
    const keyToTest = body.inworldApiKey?.trim() || await getInworldApiKey(c.env);
    const modelToTest = body.inworldLlmModel?.trim() || await getInworldLlmModel(c.env);
    try {
      return c.json(await testInworldApiKey(c.env, keyToTest, modelToTest));
    } catch (err) {
      return c.json({ message: err.message || "Inworld API test failed." }, 400);
    }
  });
  app.post("/api/config/test-qwen", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(
        await testQwenApiKey(
          c.env,
          body.qwenApiKey?.trim() || await getQwenApiKey(c.env),
          body.qwenModel?.trim() || await getQwenModel(c.env)
        )
      );
    } catch (err) {
      return c.json({ message: err.message || "Qwen API test failed." }, 400);
    }
  });
  app.post("/api/config/test-openrouter", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(
        await testOpenRouterBuzzinModel(
          c.env,
          body.openrouterApiKey?.trim() || await getOpenRouterApiKey(c.env),
          body.openrouterBuzzinModel?.trim() || await getOpenRouterBuzzinModel(c.env)
        )
      );
    } catch (err) {
      return c.json({ message: err.message || "OpenRouter API test failed." }, 400);
    }
  });
  app.post("/api/config/clear-student-database", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const cleared = await clearAll(c.env.DB);
    return c.json({ ok: true, cleared, studentDatabase: await getStats(c.env.DB) });
  });
  app.post("/api/transcribe/test", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await testOpenRouterBuzzinModel(c.env, null, body.model || void 0));
    } catch (err) {
      return c.json({ message: err.message || "OpenRouter API test failed." }, 400);
    }
  });
  app.post("/api/transcribe/audio", async (c) => {
    const formData = await c.req.formData();
    const file = parseMultipartFile(formData, "audio");
    const model = String(formData.get("model") || "").trim();
    if (!file) return c.json({ message: "Choose an audio file first." }, 400);
    try {
      const buffer = await file.arrayBuffer();
      const text = await transcribeOpenRouterAudio(c.env, {
        model: model || void 0,
        audioBuffer: new Uint8Array(buffer),
        format: audioFormatFromFilename(file.name),
        prompt: TRANSCRIBE_PROMPT
      });
      return c.json({ ok: true, text });
    } catch (err) {
      return c.json({ message: err.message || "Transcription failed.", details: err.openRouterDetails || null }, 400);
    }
  });
  app.post("/api/lango/login", async (c) => {
    const body = await c.req.json();
    const username = String(body?.username || "").trim().toLowerCase();
    const password = body?.password;
    if (!username || !password) {
      return c.json({ message: "Username and password are required." }, 400);
    }
    const { ok, status, data } = await langoRequest(c.env, "POST", "/user/login", {
      body: { username, password }
    });
    if (!ok) return c.json(data || { message: "Login failed" }, status);
    return c.json(data);
  });
  app.get("/api/lango/classList", async (c) => {
    const token = pickToken(c.req.raw);
    if (!token) return c.json({ message: "Missing auth token." }, 401);
    const { ok, status, data } = await langoRequest(c.env, "GET", "/whiteboard/classList", { token });
    if (!ok) return c.json(data || { message: "Failed to load classes" }, status);
    return c.json({ ...normalizeClassListResponse(data), _rawClassList: data });
  });
  app.post("/api/lango/sendNotification", async (c) => {
    const token = pickToken(c.req.raw);
    if (!token) return c.json({ message: "Missing auth token." }, 401);
    const body = await c.req.json();
    const { class_id, title: title2, body: notifyBody, data: notifyData } = body || {};
    if (!class_id || !title2) return c.json({ message: "class_id and title are required." }, 400);
    const payload = {
      class_id,
      title: title2,
      body: notifyBody || "Class will start soon",
      data: await buildNotificationData(c.env, notifyData || {})
    };
    const { ok, status, data } = await langoRequest(c.env, "POST", "/whiteboard/sendNotification", {
      token,
      body: payload
    });
    if (!ok) return c.json(data || { message: "Failed to send notification." }, status);
    return c.json({ ok: true, notification: payload, apiResponse: data });
  });
  app.get("/api/cms/courses", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const classId = c.req.query("classId") != null ? Number(c.req.query("classId")) : void 0;
    return c.json({
      courses: await listCoursesForTeacher(c.env.DB, auth.teacherId, {
        classId: Number.isFinite(classId) ? classId : void 0
      })
    });
  });
  app.post("/api/cms/courses", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json();
    const course = await createCourse(c.env.DB, auth.teacherId, body || {});
    return c.json({ course }, 201);
  });
  app.get("/api/cms/courses/:courseId", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const course = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!course) return c.json({ message: "Course not found." }, 404);
    return c.json(courseDetailResponse(course));
  });
  app.put("/api/cms/courses/:courseId", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const existing = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!existing) return c.json({ message: "Course not found." }, 404);
    const body = await c.req.json();
    if (body?.banner != null && String(body.banner).trim() !== existing.banner) {
      await deleteUpload(c.env, existing.banner);
    }
    const course = await updateCourse(c.env.DB, courseId, auth.teacherId, body || {});
    return c.json({
      course: {
        id: course.id,
        name: course.name,
        description: course.description,
        banner: course.banner,
        langCode: course.langCode,
        classIds: course.classIds || [],
        updatedAt: course.updatedAt
      }
    });
  });
  app.put("/api/cms/courses/:courseId/sections", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const existing = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!existing) return c.json({ message: "Course not found." }, 404);
    const body = await c.req.json();
    const incoming = body?.sections || [];
    const oldBanners = new Map((existing.sections || []).map((s) => [s.id, s.banner || ""]));
    for (const section of incoming) {
      if (section.id == null) continue;
      const oldBanner = oldBanners.get(section.id) || "";
      const newBanner = String(section.banner || "").trim();
      if (oldBanner && oldBanner !== newBanner) await deleteUpload(c.env, oldBanner);
      oldBanners.delete(section.id);
    }
    for (const banner of oldBanners.values()) {
      if (banner) await deleteUpload(c.env, banner);
    }
    const course = await saveSections(c.env.DB, courseId, auth.teacherId, incoming);
    if (!course) return c.json({ message: "Course not found." }, 404);
    return c.json({ sections: course.sections || [], updatedAt: course.updatedAt });
  });
  app.post("/api/cms/courses/:courseId/sections/:sectionId/banner", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const sectionId = Number(c.req.param("sectionId"));
    const course = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!course) return c.json({ message: "Course not found." }, 404);
    const formData = await c.req.formData();
    const file = parseMultipartFile(formData, "banner");
    if (!file) return c.json({ message: "No image file provided." }, 400);
    try {
      const url = await uploadImage(c.env, {
        prefix: "sections",
        ownerId: `section-${courseId}-${sectionId}`,
        file
      });
      const updated = await updateSectionBanner(c.env.DB, courseId, auth.teacherId, sectionId, url);
      if (updated?.oldBanner) await deleteUpload(c.env, updated.oldBanner);
      return c.json({
        url,
        section: updated?.section || { id: sectionId, banner: url },
        updatedAt: updated?.updatedAt || null
      });
    } catch (err) {
      return c.json({ message: err.message || "Upload failed." }, 400);
    }
  });
  async function handleQuestionImage(c) {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const formData = await c.req.formData();
    const file = parseMultipartFile(formData, "image");
    if (!file) return c.json({ message: "No image file provided." }, 400);
    try {
      const url = await uploadImage(c.env, {
        prefix: "questions",
        ownerId: `teacher-${auth.teacherId}`,
        file
      });
      return c.json({ url });
    } catch (err) {
      return c.json({ message: err.message || "Upload failed." }, 400);
    }
  }
  __name(handleQuestionImage, "handleQuestionImage");
  app.post("/api/cms/question-image", handleQuestionImage);
  app.post("/api/cms/courses/:courseId/question-image", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const course = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!course) return c.json({ message: "Course not found." }, 404);
    return handleQuestionImage(c);
  });
  app.post("/api/cms/courses/:courseId/banner", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const course = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!course) return c.json({ message: "Course not found." }, 404);
    const formData = await c.req.formData();
    const file = parseMultipartFile(formData, "banner");
    if (!file) return c.json({ message: "No image file provided." }, 400);
    try {
      const url = await uploadImage(c.env, { prefix: "courses", ownerId: `course-${courseId}`, file });
      const updated = await updateCourse(c.env.DB, courseId, auth.teacherId, { banner: url });
      await deleteUpload(c.env, course.banner);
      return c.json({
        url,
        course: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          banner: updated.banner,
          langCode: updated.langCode,
          classIds: updated.classIds || [],
          updatedAt: updated.updatedAt
        }
      });
    } catch (err) {
      return c.json({ message: err.message || "Upload failed." }, 400);
    }
  });
  app.delete("/api/cms/courses/:courseId", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const courseId = Number(c.req.param("courseId"));
    const course = await getCourseForTeacher(c.env.DB, courseId, auth.teacherId);
    if (!course) return c.json({ message: "Course not found." }, 404);
    await deleteUpload(c.env, course.banner);
    for (const section of course.sections || []) {
      await deleteUpload(c.env, section.banner);
    }
    await deleteCourse(c.env.DB, courseId, auth.teacherId);
    return c.json({ ok: true });
  });
  app.post("/api/session/start", async (c) => {
    const token = pickToken(c.req.raw);
    if (!token) return c.json({ message: "Missing auth token." }, 401);
    const body = await c.req.json();
    const { class: classItem, course, exercise, user } = body || {};
    if (!classItem?.id || !user?.id) {
      return c.json({ message: "class and user with id are required." }, 400);
    }
    const sessionId = generateRoomId();
    const stub = sessionRoomStub(c.env, sessionId);
    await stub.fetch(new Request("https://do/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: sessionId,
        teacherId: user.id,
        classId: classItem.id,
        courseId: course?.id || null,
        exercise,
        classItem,
        course,
        authToken: token
      })
    }));
    const notifyBody = {
      class_id: classItem.id,
      title: course?.id ? courseDisplayName(course) : classItem.name || "Class session",
      body: "Class will start soon",
      data: await buildNotificationData(c.env, {
        session_id: sessionId,
        class_name: classItem.name || `Class ${classItem.id}`,
        teacher_name: teacherDisplayName(user),
        banner: courseBanner(course)
      })
    };
    const { ok, status, data } = await langoRequest(c.env, "POST", "/whiteboard/sendNotification", {
      token,
      body: notifyBody
    });
    if (!ok) {
      return c.json(
        {
          sessionId,
          roomId: sessionId,
          notification: notifyBody,
          notificationSent: false,
          notificationWarning: data?.message || "Waiting room created, but the notification failed.",
          apiResponse: data
        },
        201
      );
    }
    return c.json(
      { sessionId, roomId: sessionId, notification: notifyBody, apiResponse: data },
      201
    );
  });
  app.post("/api/session/end", async (c) => {
    const token = pickToken(c.req.raw);
    if (!token) return c.json({ message: "Missing auth token." }, 401);
    const body = await c.req.json();
    const { roomId, class: classItem, user } = body || {};
    const pin = normalizeRoomId(roomId);
    if (!pin) return c.json({ message: "roomId is required." }, 400);
    const stub = sessionRoomStub(c.env, pin);
    const sessionRes = await stub.fetch(new Request("https://do/session"));
    const sessionData = await sessionRes.json();
    if (!sessionData.session) return c.json({ message: "Session not found." }, 404);
    const session = sessionData.session;
    if (user?.id && session.teacherId !== user.id) {
      return c.json({ message: "Not allowed to end this session." }, 403);
    }
    await stub.fetch(new Request("https://do/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Class session ended" })
    }));
    const classId = classItem?.id || session.classId;
    const className = session.className || classItem?.name || `Class ${classId}`;
    const notifyBody = {
      class_id: classId,
      title: className,
      body: "End",
      data: await buildNotificationData(c.env, {
        session_id: pin,
        body: "End",
        class_name: className,
        teacher_name: teacherDisplayName(user || { id: session.teacherId })
      })
    };
    const { ok, data } = await langoRequest(c.env, "POST", "/whiteboard/sendNotification", {
      token: session.authToken || token,
      body: notifyBody
    });
    return c.json({
      ok: true,
      roomId: pin,
      notification: notifyBody,
      notificationSent: ok,
      notificationWarning: ok ? void 0 : data?.message || "Session ended, but the notification failed.",
      apiResponse: data
    });
  });
  app.get("/api/host/progress", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const classId = Number(c.req.query("classId"));
    const courseId = Number(c.req.query("courseId"));
    if (!Number.isFinite(classId) || !Number.isFinite(courseId)) {
      return c.json({ message: "classId and courseId query parameters are required." }, 400);
    }
    return c.json({
      progress: await getProgress(c.env.DB, auth.teacherId, classId, courseId)
    });
  });
  app.put("/api/host/progress", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const body = await c.req.json();
    const classId = Number(body?.classId);
    const courseId = Number(body?.courseId);
    if (!Number.isFinite(classId) || !Number.isFinite(courseId)) {
      return c.json({ message: "classId and courseId are required." }, 400);
    }
    const patch = {};
    if (body.completedExerciseIds != null) patch.completedExerciseIds = body.completedExerciseIds;
    if (body.visitedSectionIds != null) patch.visitedSectionIds = body.visitedSectionIds;
    if (body.lastSectionId !== void 0) patch.lastSectionId = body.lastSectionId;
    if (body.lastExerciseId !== void 0) patch.lastExerciseId = body.lastExerciseId;
    const progress = await upsertProgress(c.env.DB, auth.teacherId, classId, courseId, patch);
    return c.json({ progress });
  });
  app.get("/api/scores", async (c) => {
    const auth = await requireCmsAuth(c.req.raw, c.env);
    if (auth.error) return c.json({ message: auth.error.message }, auth.error.status);
    const classId = Number(c.req.query("classId"));
    if (!Number.isFinite(classId)) {
      return c.json({ message: "classId query parameter is required." }, 400);
    }
    const courseId = c.req.query("courseId") != null ? Number(c.req.query("courseId")) : void 0;
    const exerciseId = c.req.query("exerciseId") != null ? Number(c.req.query("exerciseId")) : void 0;
    const roomId = c.req.query("roomId") ? String(c.req.query("roomId")).trim() : void 0;
    return c.json({
      classId,
      teacherId: auth.teacherId,
      semesterTotals: await listSemesterTotalsForClass(c.env.DB, auth.teacherId, classId),
      students: await listStudentsForClass(c.env.DB, auth.teacherId, classId),
      scores: await listScoresForClass(c.env.DB, auth.teacherId, classId, {
        courseId: Number.isFinite(courseId) ? courseId : void 0,
        exerciseId: Number.isFinite(exerciseId) ? exerciseId : void 0,
        roomId
      })
    });
  });
  app.get("/api/network-urls", async (c) => {
    return c.json({
      publicBaseUrl: await getPublicBaseUrl(c.env),
      platform: "cloudflare"
    });
  });
  return app;
}
__name(createApiApp, "createApiApp");

// shared/lib/exercise-quiz.js
function normalizeExerciseType(type) {
  return String(type || "").toLowerCase().replace(/[_\s-]/g, "");
}
__name(normalizeExerciseType, "normalizeExerciseType");
function isMcQuizExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "mcquiz";
}
__name(isMcQuizExercise, "isMcQuizExercise");
function isFastMcQuizExercise(exercise) {
  return normalizeExerciseType(exercise?.type) === "fastmcquiz";
}
__name(isFastMcQuizExercise, "isFastMcQuizExercise");
function isLiveMcQuizExercise(exercise) {
  return isMcQuizExercise(exercise) || isFastMcQuizExercise(exercise);
}
__name(isLiveMcQuizExercise, "isLiveMcQuizExercise");
function ensureSingleCorrectOption2(options) {
  if (!Array.isArray(options) || !options.length) return [];
  const firstCorrectIdx = options.findIndex((o) => o.isCorrect);
  const correctIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
  return options.map((o, i) => ({ ...o, isCorrect: i === correctIdx }));
}
__name(ensureSingleCorrectOption2, "ensureSingleCorrectOption");
function mcQuizPayloadFromExercise(exercise) {
  if (!exercise || !isLiveMcQuizExercise(exercise)) return null;
  const questions = (exercise.items || []).map((item) => {
    const normalizedOptions = ensureSingleCorrectOption2(
      (item.options || []).map((o) => ({
        text: String(o.text || "").trim(),
        isCorrect: !!o.isCorrect
      })).filter((o) => o.text)
    );
    const options = normalizedOptions.map((o) => o.text);
    const correctIndex = normalizedOptions.findIndex((o) => o.isCorrect);
    const image = String(item.image || item.imageUrl || "").trim();
    return {
      text: String(item.title || item.question || "").trim(),
      options,
      correctIndex: correctIndex >= 0 ? correctIndex : 0,
      timeLimit: item.timeLimit ?? item.duration_seconds ?? 15,
      image: image || null
    };
  }).filter((q) => q.text && q.options.length >= 2);
  return {
    title: exercise.title || exercise.subTitle || "Class quiz",
    questions,
    fastMode: isFastMcQuizExercise(exercise)
  };
}
__name(mcQuizPayloadFromExercise, "mcQuizPayloadFromExercise");

// workers/room/room-engine.js
var MAX_MC_OPTIONS = 6;
var MC_QUESTION_POINTS = 300;
var FAST_MC_QUESTION_POINTS = 500;
var BUZZIN_WINNER_COUNT = 1;
var BUZZIN_JOIN_SECONDS = 20;
var BUZZIN_RESPONSE_MAX_LEN = 500;
var BUZZIN_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
var RoomEngine = class {
  static {
    __name(this, "RoomEngine");
  }
  constructor(env2, roomId) {
    this.env = env2;
    this.roomId = roomId;
    this.session = null;
    this.game = null;
    this.buzzInRound = null;
    this.connections = /* @__PURE__ */ new Map();
    this.nextConnId = 1;
  }
  // --- WebSocket helpers ---
  broadcast(event, data) {
    const msg = JSON.stringify({ type: "event", event, data });
    for (const conn of this.connections.values()) {
      try {
        conn.ws.send(msg);
      } catch {
      }
    }
  }
  emitTo(connId, event, data) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    try {
      conn.ws.send(JSON.stringify({ type: "event", event, data }));
    } catch {
    }
  }
  ack(connId, ackId, data) {
    const conn = this.connections.get(connId);
    if (!conn || !ackId) return;
    try {
      conn.ws.send(JSON.stringify({ type: "ack", ackId, data }));
    } catch {
    }
  }
  participantPayload() {
    if (!this.session) return [];
    return [...this.session.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({
      id: p.userId,
      userId: p.userId,
      displayName: p.displayName,
      isReady: !!p.isReady,
      joinedAt: p.joinedAt
    }));
  }
  broadcastSessionLobby() {
    if (!this.session) return;
    this.broadcast("session_lobby_update", {
      roomId: this.roomId,
      status: this.session.status,
      participants: this.participantPayload(),
      count: this.session.participants.size
    });
  }
  generateParticipantId() {
    return `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  // --- Session init/end ---
  initSession(payload) {
    const normalizedClass = normalizeClassItem(payload.classItem || {});
    this.session = {
      roomId: this.roomId,
      teacherId: payload.teacherId,
      classId: payload.classId,
      courseId: payload.courseId,
      className: normalizedClass?.name || payload.classItem?.name || "",
      studentList: normalizedClass?.studentList || [],
      courseName: payload.course?.name || payload.course?.title || "",
      authToken: payload.authToken || null,
      exercise: payload.exercise || null,
      status: "waiting",
      participants: /* @__PURE__ */ new Map(),
      hostConnId: null,
      buzzinExerciseId: null,
      buzzinAwardedPlayers: /* @__PURE__ */ new Map(),
      createdAt: Date.now(),
      startedAt: null
    };
    return this.session;
  }
  endSession(reason) {
    if (!this.session) return;
    this.session.status = "ended";
    this.clearBuzzInRound();
    this.broadcast("session_ended", { reason: reason || "Session ended" });
    this.session = null;
    this.game = null;
  }
  getSessionSnapshot() {
    if (!this.session) return null;
    return {
      roomId: this.session.roomId,
      teacherId: this.session.teacherId,
      classId: this.session.classId,
      className: this.session.className,
      status: this.session.status,
      participantCount: this.session.participants.size,
      authToken: this.session.authToken
    };
  }
  // --- Socket event handlers ---
  async handleMessage(connId, { event, data, ackId }) {
    const handlers = {
      host_session: /* @__PURE__ */ __name(() => this.handleHostSession(connId, data, ackId), "host_session"),
      join_session: /* @__PURE__ */ __name(() => this.handleJoinSession(connId, data, ackId), "join_session"),
      start_session: /* @__PURE__ */ __name(() => this.handleStartSession(connId, data, ackId), "start_session"),
      select_session_exercise: /* @__PURE__ */ __name(() => this.handleSelectExercise(connId, data, ackId), "select_session_exercise"),
      start_buzzin_round: /* @__PURE__ */ __name(() => this.handleStartBuzzin(connId, data, ackId), "start_buzzin_round"),
      start_buzzin_countdown: /* @__PURE__ */ __name(() => this.handleBuzzinCountdown(connId, data, ackId), "start_buzzin_countdown"),
      open_buzzin_join: /* @__PURE__ */ __name(() => this.handleOpenBuzzinJoin(connId, data, ackId), "open_buzzin_join"),
      buzz_in: /* @__PURE__ */ __name(() => this.handleBuzzIn(connId, data, ackId), "buzz_in"),
      buzzin_lucky_draw: /* @__PURE__ */ __name(() => this.handleBuzzinLuckyDraw(connId, data, ackId), "buzzin_lucky_draw"),
      transcribe_buzzin_audio: /* @__PURE__ */ __name(() => this.handleTranscribeBuzzin(connId, data, ackId), "transcribe_buzzin_audio"),
      submit_buzzin_response: /* @__PURE__ */ __name(() => this.handleSubmitBuzzin(connId, data, ackId), "submit_buzzin_response"),
      get_buzzin_state: /* @__PURE__ */ __name(() => this.handleGetBuzzinState(connId, data, ackId), "get_buzzin_state"),
      end_room_exercise: /* @__PURE__ */ __name(() => this.handleEndExercise(connId, data, ackId), "end_room_exercise"),
      start_next_exercise: /* @__PURE__ */ __name(() => this.handleStartNextExercise(connId, data, ackId), "start_next_exercise"),
      create_game: /* @__PURE__ */ __name(() => this.handleCreateGame(connId, data, ackId), "create_game"),
      join_game: /* @__PURE__ */ __name(() => this.handleJoinGame(connId, data, ackId), "join_game"),
      create_room_game: /* @__PURE__ */ __name(() => this.handleCreateRoomGame(connId, data, ackId), "create_room_game"),
      join_room_game: /* @__PURE__ */ __name(() => this.handleJoinRoomGame(connId, data, ackId), "join_room_game"),
      start_game: /* @__PURE__ */ __name(() => this.handleStartGame(connId), "start_game"),
      start_room_game: /* @__PURE__ */ __name(() => this.handleStartGame(connId), "start_room_game"),
      next_question: /* @__PURE__ */ __name(() => this.handleNextQuestion(connId), "next_question"),
      question_tts_done: /* @__PURE__ */ __name(() => this.handleQuestionTtsDone(connId, data), "question_tts_done"),
      submit_answer: /* @__PURE__ */ __name(() => this.handleSubmitAnswer(connId, data), "submit_answer")
    };
    const handler = handlers[event];
    if (handler) {
      try {
        await handler();
      } catch (err) {
        this.ack(connId, ackId, { ok: false, error: err.message || "Server error." });
      }
    }
  }
  handleDisconnect(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    if (conn.role === "session_player" && conn.playerId && this.session) {
      for (const [uid, p] of this.session.participants) {
        if (p.connId === connId) {
          p.connId = null;
          break;
        }
      }
      this.broadcastSessionLobby();
    }
    if (conn.role === "host" && this.session) {
      this.endSession("Host left the session");
    } else if (conn.role === "player" && conn.playerId && this.game) {
      const player = this.game.players.get(conn.playerId);
      if (this.game.isRoomGame) {
        if (player) player.connId = null;
      } else {
        this.game.players.delete(conn.playerId);
        if (this.game.status === "lobby") this.broadcastLobby();
      }
    }
    this.connections.delete(connId);
  }
  handleHostSession(connId, { roomId }, ackId) {
    const pin = normalizeRoomId(roomId) || this.roomId;
    if (!this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Room not found." });
    }
    this.session.hostConnId = connId;
    const conn = this.connections.get(connId);
    if (conn) conn.role = "host";
    this.ack(connId, ackId, {
      ok: true,
      roomId: pin,
      status: this.session.status,
      participants: this.participantPayload()
    });
    this.broadcastSessionLobby();
  }
  handleJoinSession(connId, { roomId, displayName, nickname, userId }, ackId) {
    if (!this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Room not found. Check the 6-digit code with your teacher." });
    }
    if (this.session.status === "ended") {
      return this.ack(connId, ackId, { ok: false, error: "This class session has ended." });
    }
    let playerId = String(userId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    if (!playerId) playerId = this.generateParticipantId();
    let name = String(displayName || nickname || "").trim().slice(0, 40);
    if (!name) {
      const student = findStudentById(this.session.studentList, playerId);
      name = String(student?.fullName || "").trim().slice(0, 40);
    }
    if (!name) return this.ack(connId, ackId, { ok: false, error: "Enter your name." });
    const nameTaken = [...this.session.participants.values()].some(
      (p) => p.userId !== playerId && p.displayName.toLowerCase() === name.toLowerCase()
    );
    if (nameTaken) return this.ack(connId, ackId, { ok: false, error: "Name already taken in this class." });
    const existing = this.session.participants.get(playerId);
    if (existing) {
      existing.displayName = name;
      existing.connId = connId;
    } else {
      this.session.participants.set(playerId, {
        userId: playerId,
        displayName: name,
        connId,
        isReady: false,
        joinedAt: Date.now()
      });
    }
    const conn = this.connections.get(connId);
    if (conn) {
      conn.role = "session_player";
      conn.playerId = playerId;
    }
    if (this.game?.isRoomGame) this.syncRoomGamePlayersFromSession();
    this.ack(connId, ackId, {
      ok: true,
      roomId: this.roomId,
      userId: playerId,
      displayName: name,
      sessionStatus: this.session.status
    });
    this.broadcastSessionLobby();
    if (this.session.status === "start") {
      this.emitTo(connId, "session_started", { exercise: this.session.exercise });
    }
  }
  handleStartSession(connId, { roomId }, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Only the host can start the class." });
    }
    if (!this.session.exercise?.id) {
      return this.ack(connId, ackId, { ok: false, error: "Select an exercise before starting the class." });
    }
    const alreadyStarted = this.session.status === "start";
    if (!alreadyStarted) {
      this.session.status = "start";
      this.session.startedAt = Date.now();
    }
    this.broadcast("session_started", { exercise: this.session.exercise });
    this.broadcastSessionLobby();
    this.ack(connId, ackId, { ok: true, roomId: this.roomId, status: "start", alreadyStarted });
  }
  handleSelectExercise(connId, { roomId, exercise, course }, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Only the host can select an exercise." });
    }
    if (!exercise?.id) {
      return this.ack(connId, ackId, { ok: false, error: "Select a valid exercise." });
    }
    this.session.exercise = exercise;
    if (course?.id) {
      this.session.courseId = course.id;
      this.session.courseName = course.name || course.title || "";
    }
    this.ack(connId, ackId, {
      ok: true,
      roomId: this.roomId,
      status: this.session.status,
      exercise: this.session.exercise
    });
  }
  // --- Quiz game logic (abbreviated but functional) ---
  normalizeClientQuiz(quiz) {
    const questions = (quiz?.questions || []).slice(0, 20).map((q) => {
      const options = (q.options || []).slice(0, MAX_MC_OPTIONS).map((o) => String(o).slice(0, 200));
      const correctIndex = Math.min(Math.max(0, options.length - 1), Math.max(0, Number(q.correctIndex) || 0));
      const image = String(q.image || q.imageUrl || "").trim().slice(0, 500);
      return {
        text: String(q.text || "").slice(0, 500),
        options,
        correctIndex,
        timeLimit: Math.min(60, Math.max(5, Number(q.timeLimit) || 15)),
        image: image || null
      };
    }).filter((q) => q.text && q.options.length >= 2);
    return { title: String(quiz?.title || "Class quiz").slice(0, 100), questions, fastMode: !!quiz?.fastMode };
  }
  async quizPayloadForRoomGame(clientQuiz) {
    if (!this.session?.courseId || !this.session.exercise?.id || !this.session.teacherId) return clientQuiz;
    const course = await getCourseForTeacher(this.env.DB, this.session.courseId, this.session.teacherId);
    if (!course) return clientQuiz;
    const exercise = flattenExercises(course).find((e) => e.id === this.session.exercise.id);
    if (!exercise || !isLiveMcQuizExercise(exercise)) return clientQuiz;
    const payload = mcQuizPayloadFromExercise(exercise);
    return payload?.questions?.length ? payload : clientQuiz;
  }
  syncRoomGamePlayersFromSession() {
    if (!this.game?.isRoomGame || !this.session) return;
    for (const participant of this.session.participants.values()) {
      const existing = this.game.players.get(participant.userId);
      if (existing) {
        existing.name = participant.displayName || existing.name;
        continue;
      }
      this.game.players.set(participant.userId, {
        id: participant.userId,
        name: participant.displayName,
        score: 0,
        correctAnswers: 0,
        connId: null,
        participated: false
      });
    }
  }
  broadcastLobby() {
    if (!this.game) return;
    this.broadcast("lobby_update", {
      pin: this.game.pin,
      quizTitle: this.game.quiz.title,
      players: [...this.game.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score })),
      status: this.game.status
    });
  }
  questionPointsForGame() {
    return this.game?.fastMode ? FAST_MC_QUESTION_POINTS : MC_QUESTION_POINTS;
  }
  getLeaderboard() {
    return [...this.game.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }
  clearQuestionTimer() {
    if (this.game?.questionTimer) {
      clearTimeout(this.game.questionTimer);
      this.game.questionTimer = null;
    }
  }
  async handleCreateRoomGame(connId, { roomId, quiz }, ackId) {
    const pin = normalizeRoomId(roomId) || this.roomId;
    const resolvedQuiz = this.normalizeClientQuiz(await this.quizPayloadForRoomGame(quiz));
    if (!resolvedQuiz.questions.length) {
      return this.ack(connId, ackId, { ok: false, error: "Invalid room or quiz." });
    }
    this.clearQuestionTimer();
    const roomPlayers = new Map(
      [...this.session?.participants?.values() || []].map((p) => [
        p.userId,
        { id: p.userId, name: p.displayName, score: 0, correctAnswers: 0, connId: null, participated: false }
      ])
    );
    this.game = {
      pin,
      hostConnId: connId,
      quiz: resolvedQuiz,
      status: "lobby",
      players: roomPlayers,
      currentQuestionIndex: -1,
      questionStartedAt: null,
      answers: /* @__PURE__ */ new Map(),
      answerHistory: [],
      questionTimer: null,
      isRoomGame: true,
      scoresSaved: false,
      fastMode: !!resolvedQuiz.fastMode
    };
    const conn = this.connections.get(connId);
    if (conn) conn.role = "host";
    this.ack(connId, ackId, {
      ok: true,
      roomId: pin,
      quizTitle: this.game.quiz.title,
      questionCount: this.game.quiz.questions.length
    });
    this.broadcastLobby();
  }
  handleJoinRoomGame(connId, { roomId, nickname, userId }, ackId) {
    if (!this.game?.isRoomGame) {
      return this.ack(connId, ackId, { ok: false, error: "Class quiz not started yet. Wait for your teacher." });
    }
    if (this.game.status === "finished") {
      return this.ack(connId, ackId, { ok: false, error: "Class quiz has ended." });
    }
    let playerId = String(userId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    let name = String(nickname || "").trim().slice(0, 40);
    if (this.session) {
      if (!playerId) return this.ack(connId, ackId, { ok: false, error: "Rejoin the class waiting room first." });
      const participant = this.session.participants.get(playerId);
      if (!participant) {
        return this.ack(connId, ackId, { ok: false, error: "Join the class waiting room before the quiz starts." });
      }
      name = participant.displayName || name;
    }
    if (!name) return this.ack(connId, ackId, { ok: false, error: "Enter your name." });
    this.game.players.set(playerId, {
      id: playerId,
      name,
      score: this.game.players.get(playerId)?.score || 0,
      correctAnswers: this.game.players.get(playerId)?.correctAnswers || 0,
      connId,
      participated: true
    });
    const conn = this.connections.get(connId);
    if (conn) {
      conn.role = "player";
      conn.playerId = playerId;
    }
    this.ack(connId, ackId, { ok: true, roomId: this.game.pin, quizTitle: this.game.quiz.title, playerId });
    if (this.game.status === "lobby") {
      this.broadcastLobby();
    } else if (["speaking", "question"].includes(this.game.status)) {
      this.emitTo(connId, "game_starting", {
        totalQuestions: this.game.quiz.questions.length,
        fastMode: this.game.fastMode
      });
      this.emitCurrentQuestion(connId);
    }
  }
  handleStartGame(connId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.game || this.game.status !== "lobby") return;
    if (!this.game.isRoomGame && this.game.players.size === 0) return;
    this.game.status = "starting";
    this.broadcast("game_starting", {
      totalQuestions: this.game.quiz.questions.length,
      fastMode: !!this.game.fastMode
    });
    this.clearQuestionTimer();
    this.game.questionTimer = setTimeout(() => {
      this.game.questionTimer = null;
      this.startQuestion();
    }, this.game.fastMode ? 2e3 : 0);
  }
  emitCurrentQuestion(connId) {
    const question = this.game.quiz.questions[this.game.currentQuestionIndex];
    if (!question) return;
    const timeLimitSeconds = question.timeLimit || 15;
    this.emitTo(connId, "question_start", {
      questionIndex: this.game.currentQuestionIndex,
      totalQuestions: this.game.quiz.questions.length,
      text: question.text,
      options: question.options,
      timeLimit: timeLimitSeconds,
      endsAt: this.game.questionStartedAt ? this.game.questionStartedAt + timeLimitSeconds * 1e3 : Date.now() + timeLimitSeconds * 1e3,
      points: this.questionPointsForGame(),
      image: question.image || null,
      fastMode: !!this.game.fastMode
    });
  }
  startQuestion() {
    const nextIndex = this.game.currentQuestionIndex + 1;
    if (nextIndex >= this.game.quiz.questions.length) {
      this.game.status = "finished";
      void this.persistExerciseScores();
      const exerciseLeaderboard = this.getLeaderboard();
      this.broadcast("game_finished", {
        leaderboard: exerciseLeaderboard,
        ...this.buildExerciseFinishedPayload({ exerciseLeaderboard })
      });
      return;
    }
    this.game.currentQuestionIndex = nextIndex;
    this.game.status = "question";
    this.game.answers.clear();
    this.game.questionStartedAt = Date.now();
    this.syncRoomGamePlayersFromSession();
    const question = this.game.quiz.questions[nextIndex];
    const timeLimit = (question.timeLimit || 15) * 1e3;
    this.broadcast("question_start", {
      questionIndex: nextIndex,
      totalQuestions: this.game.quiz.questions.length,
      text: question.text,
      options: question.options,
      timeLimit: question.timeLimit || 15,
      endsAt: this.game.questionStartedAt + timeLimit,
      points: this.questionPointsForGame(),
      image: question.image || null,
      fastMode: !!this.game.fastMode
    });
    this.clearQuestionTimer();
    this.game.questionTimer = setTimeout(() => this.endQuestion(), timeLimit);
  }
  endQuestion() {
    if (!this.game || this.game.status !== "question") return;
    this.clearQuestionTimer();
    this.game.status = "results";
    const question = this.game.quiz.questions[this.game.currentQuestionIndex];
    const results = [];
    for (const player of this.game.players.values()) {
      const answer = this.game.answers.get(player.id);
      if (answer && answer.answerIndex === question.correctIndex) {
        const points = this.questionPointsForGame();
        player.score += points;
        player.correctAnswers = (player.correctAnswers || 0) + 1;
        results.push({ playerId: player.id, name: player.name, correct: true, points, answerIndex: answer.answerIndex });
      } else if (answer) {
        results.push({ playerId: player.id, name: player.name, correct: false, points: 0, answerIndex: answer.answerIndex });
      } else {
        results.push({ playerId: player.id, name: player.name, correct: false, points: 0, answerIndex: null });
      }
    }
    if (this.game.fastMode) {
      this.game.answerHistory[this.game.currentQuestionIndex] = results.map((r) => ({
        playerId: r.playerId,
        answerIndex: r.answerIndex,
        correct: r.correct
      }));
      const isLast = this.game.currentQuestionIndex + 1 >= this.game.quiz.questions.length;
      this.broadcast("question_between", {
        questionIndex: this.game.currentQuestionIndex,
        totalQuestions: this.game.quiz.questions.length,
        isLast
      });
      this.clearQuestionTimer();
      this.game.questionTimer = setTimeout(() => {
        this.game.questionTimer = null;
        this.startQuestion();
      }, 1500);
      return;
    }
    this.broadcast("question_results", {
      questionIndex: this.game.currentQuestionIndex,
      correctIndex: question.correctIndex,
      results,
      leaderboard: this.getLeaderboard()
    });
  }
  handleNextQuestion(connId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.game || this.game.status !== "results") return;
    this.startQuestion();
  }
  handleQuestionTtsDone(connId, { questionIndex }) {
  }
  handleSubmitAnswer(connId, { answerIndex }) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "player" || !conn.playerId || !this.game || this.game.status !== "question") return;
    if (this.game.answers.has(conn.playerId)) return;
    this.syncRoomGamePlayersFromSession();
    const player = this.game.players.get(conn.playerId);
    if (player) player.participated = true;
    const idx = Number(answerIndex);
    const question = this.game.quiz.questions[this.game.currentQuestionIndex];
    if (!Number.isInteger(idx) || idx < 0 || idx >= (question?.options?.length || 0)) return;
    this.game.answers.set(conn.playerId, { answerIndex: idx, timeMs: Date.now() - this.game.questionStartedAt });
    this.emitTo(connId, "answer_received", {});
    if (this.game.answers.size >= this.game.players.size) {
      this.endQuestion();
    }
  }
  async persistExerciseScores() {
    if (!this.session || !this.game || this.game.scoresSaved) return;
    this.game.scoresSaved = true;
    const exercise = this.session.exercise;
    if (!exercise?.id) return;
    const scores = [...this.game.players.values()].filter((p) => !this.game.isRoomGame || p.participated).map((p) => {
      const participant = this.session.participants.get(p.id);
      return {
        studentUserId: p.id,
        displayName: participant?.displayName || p.name || "Student",
        score: p.score
      };
    });
    await saveExerciseScores(this.env.DB, {
      teacherId: this.session.teacherId,
      classId: this.session.classId,
      courseId: this.session.courseId,
      exerciseId: exercise.id,
      exerciseTitle: exercise.title || exercise.subTitle || "",
      exerciseType: exercise.type || "mcquiz",
      roomId: this.roomId,
      scores
    });
  }
  async getSemesterLeaderboard() {
    if (!this.session) return [];
    return (await listSemesterTotalsForClass(this.env.DB, this.session.teacherId, this.session.classId)).map(
      (s) => ({ id: s.studentUserId, name: s.displayName, score: s.totalScore })
    );
  }
  buildExerciseFinishedPayload({ exerciseLeaderboard } = {}) {
    return { exerciseLeaderboard: exerciseLeaderboard || null, semesterLeaderboard: [] };
  }
  async handleEndExercise(connId, { exerciseId, exerciseType }, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Only the host can end an exercise." });
    }
    let exerciseLeaderboard = null;
    if (isLiveMcQuizExercise({ type: exerciseType }) && this.game) {
      await this.persistExerciseScores();
      exerciseLeaderboard = this.getLeaderboard();
    }
    const payload = {
      exerciseLeaderboard,
      semesterLeaderboard: await this.getSemesterLeaderboard()
    };
    if (this.game) {
      this.clearQuestionTimer();
      this.game = null;
    }
    this.clearBuzzInRound();
    this.session.status = "waiting";
    this.session.exercise = null;
    this.session.startedAt = null;
    this.broadcast("room_exercise_wrap_up", payload);
    this.broadcastSessionLobby();
    this.ack(connId, ackId, { ok: true, ...payload });
  }
  handleStartNextExercise(connId, { roomId, exercise, course }, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Only the host can start the next exercise." });
    }
    if (!exercise?.id) return this.ack(connId, ackId, { ok: false, error: "Exercise is required." });
    this.session.exercise = exercise;
    if (course?.id) {
      this.session.courseId = course.id;
      this.session.courseName = course.name || course.title || "";
    }
    if (this.game) {
      this.clearQuestionTimer();
      this.game = null;
    }
    this.clearBuzzInRound();
    this.session.status = "start";
    this.session.startedAt = Date.now();
    this.broadcast("session_started", { exercise: this.session.exercise });
    this.broadcastSessionLobby();
    this.ack(connId, ackId, { ok: true, roomId: this.roomId, status: this.session.status, exercise: this.session.exercise });
  }
  // --- Buzz-in (core flow) ---
  clearBuzzInRound() {
    if (this.buzzInRound?.joinTimer) clearTimeout(this.buzzInRound.joinTimer);
    this.buzzInRound = null;
  }
  buzzInPublicPayload(round) {
    const joinRemainingMs = round.phase === "join" ? Math.max(0, round.joinEndsAt - Date.now()) : 0;
    return {
      roundId: round.roundId,
      phase: round.phase,
      status: round.status,
      winners: round.buzzes.slice(0, BUZZIN_WINNER_COUNT),
      buzzes: round.buzzes,
      totalBuzzes: round.buzzes.length,
      winnerCount: BUZZIN_WINNER_COUNT,
      joinSeconds: BUZZIN_JOIN_SECONDS,
      joinEndsAt: round.joinEndsAt,
      joinSecondsRemaining: Math.ceil(joinRemainingMs / 1e3),
      topic: round.topic || "",
      currentTurn: round.phase === "typing" ? round.buzzes[round.turnIndex] || null : null,
      responses: round.responses
    };
  }
  async handleStartBuzzin(connId, _data, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.session) {
      return this.ack(connId, ackId, { ok: false, error: "Only the host can start a buzz-in round." });
    }
    const exercise = this.session.exercise;
    const topic = String(exercise?.items?.[0]?.topic || exercise?.title || "").trim();
    const sttLanguage = exercise?.items?.[0]?.sttLanguage || await getInworldSttLanguage(this.env);
    if (this.session.buzzinExerciseId !== exercise?.id) {
      this.session.buzzinExerciseId = exercise?.id || null;
      this.session.buzzinAwardedPlayers = /* @__PURE__ */ new Map();
    }
    this.buzzInRound = {
      roundId: Date.now(),
      phase: "ready",
      status: "open",
      topic,
      sttLanguage,
      buzzes: [],
      responses: [],
      turnIndex: 0,
      joinEndsAt: 0,
      joinTimer: null,
      ineligiblePlayerIds: [...this.session.buzzinAwardedPlayers.keys()]
    };
    const payload = this.buzzInPublicPayload(this.buzzInRound);
    let topicAudio = null;
    let topicAudioFormat = null;
    try {
      const apiKey = await getInworldApiKey(this.env);
      if (apiKey && topic) {
        const tts = await inworldTtsSynthesize(this.env, topic);
        topicAudio = tts.audioContent;
        topicAudioFormat = tts.format;
      }
    } catch {
    }
    this.broadcast("buzzin_round_started", payload);
    this.ack(connId, ackId, { ok: true, ...payload, topicAudio, topicAudioFormat });
  }
  handleBuzzinCountdown(connId, _data, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.buzzInRound) {
      return this.ack(connId, ackId, { ok: false, error: "Buzz-in round not prepared." });
    }
    this.broadcast("buzzin_countdown", {});
    this.ack(connId, ackId, { ok: true });
  }
  handleOpenBuzzinJoin(connId, _data, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "host" || !this.buzzInRound || this.buzzInRound.phase !== "ready") {
      return this.ack(connId, ackId, { ok: false, error: "Could not open buzz in." });
    }
    this.buzzInRound.phase = "join";
    this.buzzInRound.joinEndsAt = Date.now() + BUZZIN_JOIN_SECONDS * 1e3;
    this.buzzInRound.joinTimer = setTimeout(() => this.finalizeBuzzInJoin(), BUZZIN_JOIN_SECONDS * 1e3);
    const payload = this.buzzInPublicPayload(this.buzzInRound);
    this.broadcast("buzzin_join_opened", payload);
    this.ack(connId, ackId, { ok: true, ...payload });
  }
  finalizeBuzzInJoin() {
    if (!this.buzzInRound || this.buzzInRound.phase !== "join") return;
    if (this.buzzInRound.joinTimer) clearTimeout(this.buzzInRound.joinTimer);
    this.buzzInRound.phase = "typing";
    this.buzzInRound.status = "closed";
    this.broadcast("buzzin_update", this.buzzInPublicPayload(this.buzzInRound));
  }
  handleBuzzIn(connId, _data, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || conn.role !== "session_player" || !conn.playerId || !this.buzzInRound) {
      return this.ack(connId, ackId, { ok: false, error: "Join the class waiting room first." });
    }
    const round = this.buzzInRound;
    if (round.phase !== "join" || round.status !== "open") {
      return this.ack(connId, ackId, { ok: false, error: "Buzz in is closed." });
    }
    if (this.session?.buzzinAwardedPlayers?.has(conn.playerId)) {
      return this.ack(connId, ackId, { ok: false, error: "You already won 300 points in this Buzz In exercise." });
    }
    if (round.buzzes.length >= BUZZIN_WINNER_COUNT) {
      return this.ack(connId, ackId, { ok: false, error: "Someone already buzzed in." });
    }
    const participant = this.session.participants.get(conn.playerId);
    const rank = round.buzzes.length + 1;
    round.buzzes.push({ playerId: conn.playerId, displayName: participant?.displayName || "Student", rank, at: Date.now() });
    this.session.buzzinAwardedPlayers.set(conn.playerId, participant?.displayName || "Student");
    if (round.buzzes.length >= BUZZIN_WINNER_COUNT) this.finalizeBuzzInJoin();
    else this.broadcast("buzzin_update", this.buzzInPublicPayload(round));
    this.ack(connId, ackId, { ok: true, rank, selected: rank <= BUZZIN_WINNER_COUNT, roundId: round.roundId });
  }
  handleBuzzinLuckyDraw(connId, _data, ackId) {
    this.ack(connId, ackId, { ok: false, error: "Lucky draw not yet implemented on Cloudflare." });
  }
  handleTranscribeBuzzin(connId, _data, ackId) {
    this.ack(connId, ackId, { ok: false, error: "Use text input for buzz-in on Cloudflare." });
  }
  handleSubmitBuzzin(connId, { text }, ackId) {
    const conn = this.connections.get(connId);
    if (!conn || !this.buzzInRound || this.buzzInRound.phase !== "typing") {
      return this.ack(connId, ackId, { ok: false, error: "It is not your turn to answer yet." });
    }
    const trimmed = String(text || "").trim();
    if (!trimmed) return this.ack(connId, ackId, { ok: false, error: "Record your answer before submitting." });
    const current = this.buzzInRound.buzzes[this.buzzInRound.turnIndex];
    if (!current || current.playerId !== conn.playerId) {
      return this.ack(connId, ackId, { ok: false, error: "It is not your turn to answer yet." });
    }
    this.buzzInRound.responses.push({
      playerId: conn.playerId,
      displayName: current.displayName,
      rank: current.rank,
      text: trimmed.slice(0, BUZZIN_RESPONSE_MAX_LEN),
      at: Date.now(),
      analysisStatus: "pending"
    });
    this.buzzInRound.turnIndex += 1;
    this.broadcast("buzzin_update", this.buzzInPublicPayload(this.buzzInRound));
    this.ack(connId, ackId, { ok: true, ...this.buzzInPublicPayload(this.buzzInRound) });
  }
  handleGetBuzzinState(connId, _data, ackId) {
    if (!this.buzzInRound) return this.ack(connId, ackId, { ok: true, active: false });
    this.ack(connId, ackId, { ok: true, active: true, ...this.buzzInPublicPayload(this.buzzInRound) });
  }
  handleCreateGame(connId, { quiz }, ackId) {
    this.ack(connId, ackId, { ok: false, error: "Standalone games use room games in class sessions." });
  }
  handleJoinGame(connId, _data, ackId) {
    this.ack(connId, ackId, { ok: false, error: "Use join_room_game for class sessions." });
  }
};

// workers/durable-objects/session-room.js
var SessionRoom = class {
  static {
    __name(this, "SessionRoom");
  }
  constructor(state, env2) {
    this.state = state;
    this.env = env2;
    this.engine = null;
  }
  getEngine(roomId) {
    if (!this.engine) {
      this.engine = new RoomEngine(this.env, roomId);
    }
    return this.engine;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      const payload = await request.json();
      const engine = this.getEngine(payload.roomId);
      engine.initSession(payload);
      return Response.json({ ok: true, roomId: payload.roomId });
    }
    if (url.pathname === "/session") {
      const engine = this.engine;
      return Response.json({ session: engine?.getSessionSnapshot() || null });
    }
    if (url.pathname === "/end" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (this.engine) this.engine.endSession(body.reason);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || this.engine?.roomId;
      if (!roomId) return new Response("Missing room", { status: 400 });
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const engine = this.getEngine(roomId);
      if (!engine.session) {
        return new Response("Session not found", { status: 404 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const connId = String(engine.nextConnId++);
      engine.connections.set(connId, { ws: server, role: "guest", playerId: null });
      server.addEventListener("message", async (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "emit") {
            await engine.handleMessage(connId, msg);
          }
        } catch {
        }
      });
      server.addEventListener("close", () => engine.handleDisconnect(connId));
      server.addEventListener("error", () => engine.handleDisconnect(connId));
      server.send(JSON.stringify({ type: "connect" }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }
};

// workers/index.js
var api = createApiApp();
var workers_default = {
  async fetch(request, env2, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/uploads/")) {
      const uploadResponse = await serveUpload(env2, url.pathname);
      if (uploadResponse) return uploadResponse;
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/socket.io/" || url.pathname.startsWith("/ws")) {
      const roomId = url.searchParams.get("room");
      if (!roomId) return new Response("Missing room parameter", { status: 400 });
      const id = env2.SESSION_ROOM.idFromName(roomId);
      const stub = env2.SESSION_ROOM.get(id);
      return stub.fetch(new Request(`https://do/ws?room=${roomId}`, {
        headers: request.headers
      }));
    }
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env2, ctx);
    }
    if (url.pathname === "/") {
      return Response.redirect(new URL("/host.html", url.origin), 302);
    }
    return env2.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-HkzXuW/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = workers_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-HkzXuW/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  SessionRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
