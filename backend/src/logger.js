import pino from "pino";
import { env, isProduction } from "./config/env.js";

const isTest = env.nodeEnv === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "silent" : isProduction ? "info" : "debug"),
  transport: isProduction || isTest
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});
