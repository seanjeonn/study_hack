import "dotenv/config";
import express from "express";
import { HealthResponseSchema } from "@study-hack/shared";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.get("/health", (_req, res) => {
  // Validate the outbound payload against the shared schema at the boundary
  // before returning it to the client (zod SSOT in @study-hack/shared).
  const payload = HealthResponseSchema.parse({
    status: "ok",
    service: "api",
    time: new Date().toISOString(),
  });
  res.json(payload);
});

app.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
});
