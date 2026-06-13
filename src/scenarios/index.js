// src/scenarios/index.js
import nextTickVsPromise from "./nexttick-vs-promise.js";
import promiseVsCallback from "./promise-vs-callback.js";
import timeoutVsImmediate from "./timeout-vs-immediate.js";
import syncVsAsyncFs from "./sync-vs-async-fs.js";
import httpUsersDb from "./http-users-db.js";
import routeOrders from "./route-orders.js";
import routeDashboard from "./route-dashboard.js";
import routeLogin from "./route-login.js";
import routeUpload from "./route-upload.js";
import routeReports from "./route-reports.js";
import routeExport from "./route-export.js";
import routeAnalytics from "./route-analytics.js";
import routeProducts from "./route-products.js";
import routePayment from "./route-payment.js";
import routeSearch from "./route-search.js";
import routeDocuments from "./route-documents.js";

export const scenarios = [
  nextTickVsPromise,
  promiseVsCallback,
  timeoutVsImmediate,
  syncVsAsyncFs,
  httpUsersDb,
  routeOrders,
  routeDashboard,
  routeLogin,
  routeUpload,
  routeReports,
  routeExport,
  routeAnalytics,
  routeProducts,
  routePayment,
  routeSearch,
  routeDocuments,
];
