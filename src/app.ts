import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "@/config/env";
import routes from "@/routes";
import { errorHandler } from "@/middleware/errorHandler";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json());

  // Global baseline rate limit; auth routes layer a stricter one on top.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", routes);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);

  return app;
}
