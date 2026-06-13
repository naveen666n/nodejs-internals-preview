// src/scenarios/index.js
import nextTickVsPromise from "./nexttick-vs-promise.js";
import promiseVsCallback from "./promise-vs-callback.js";
import timeoutVsImmediate from "./timeout-vs-immediate.js";
import syncVsAsyncFs from "./sync-vs-async-fs.js";
import httpUsersDb from "./http-users-db.js";

export const scenarios = [
  nextTickVsPromise,
  promiseVsCallback,
  timeoutVsImmediate,
  syncVsAsyncFs,
  httpUsersDb,
];
