// src/scenarios/index.js
import nextTickVsPromise from "./nexttick-vs-promise.js";
import promiseVsCallback from "./promise-vs-callback.js";
import timeoutVsImmediate from "./timeout-vs-immediate.js";
import syncVsAsyncFs from "./sync-vs-async-fs.js";
import httpUsersDb from "./http-users-db.js";
import routeOrders from "./route-orders.js";
import routeDashboard from "./route-dashboard.js";
import routeLogin from "./route-login.js";

export const scenarios = [
  nextTickVsPromise,
  promiseVsCallback,
  timeoutVsImmediate,
  syncVsAsyncFs,
  httpUsersDb,
  routeOrders,
  routeDashboard,
  routeLogin,
];
