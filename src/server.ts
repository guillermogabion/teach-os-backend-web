import { createApp } from "@/app";
import { env } from "@/config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`TeachOS Admin API listening on http://localhost:${env.port}`);
});
